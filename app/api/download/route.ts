import { NextRequest, NextResponse } from "next/server";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { Readable } from "stream";

export const runtime = "nodejs";
export const maxDuration = 300;

const execAsync = promisify(exec);

function toWebStream(nodeStream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer) =>
        controller.enqueue(new Uint8Array(chunk))
      );
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => controller.error(err));
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

export async function GET(req: NextRequest) {
  const watchUrl = req.nextUrl.searchParams.get("url");
  const mode = req.nextUrl.searchParams.get("mode") || "merge";
  const title = req.nextUrl.searchParams.get("title") || "video";

  if (!watchUrl || !watchUrl.startsWith("https://www.youtube.com/watch?v=")) {
    return new NextResponse("허용되지 않은 URL입니다.", { status: 403 });
  }

  const safeTitle = title.replace(/[<>:"/\\|?*]/g, "").trim() || "video";
  const responseHeaders = new Headers({
    "Content-Type": "video/mp4",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeTitle)}.mp4`,
  });

  try {
    // yt-dlp로 직접 다운로드 URL 추출
    // merge: "bestvideo[ext=mp4]+bestaudio[ext=m4a]" → 2줄 반환
    // direct: "best[ext=mp4]" → 1줄 반환
    const formatSelector =
      mode === "merge"
        ? "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio/best[ext=mp4]/best"
        : "best[ext=mp4]/best";

    const { stdout } = await execAsync(
      `yt-dlp -f "${formatSelector}" --get-url --no-warnings "${watchUrl}"`,
      { maxBuffer: 5 * 1024 * 1024 }
    );

    const urls = stdout.trim().split("\n").filter(Boolean);
    const videoUrl = urls[0];
    const audioUrl = urls[1]; // merge 모드에서만 존재

    const youtubeHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Referer: "https://www.youtube.com/",
      Origin: "https://www.youtube.com",
    };

    // --- Direct 모드: 단일 스트림 프록시 ---
    if (!audioUrl) {
      const res = await fetch(videoUrl, { headers: youtubeHeaders });
      if (!res.ok || !res.body) {
        return new NextResponse("영상을 가져오지 못했습니다.", { status: 502 });
      }
      const cl = res.headers.get("Content-Length");
      if (cl) responseHeaders.set("Content-Length", cl);
      return new NextResponse(res.body, { headers: responseHeaders });
    }

    // --- Merge 모드: Node.js fetch → ffmpeg pipe:3/pipe:4 → stdout ---
    const [videoRes, audioRes] = await Promise.all([
      fetch(videoUrl, { headers: youtubeHeaders }),
      fetch(audioUrl, { headers: youtubeHeaders }),
    ]);

    if (!videoRes.ok || !audioRes.ok || !videoRes.body || !audioRes.body) {
      return new NextResponse("스트림을 가져오지 못했습니다.", { status: 502 });
    }

    // Web ReadableStream → Node.js Readable 변환
    const videoNode = Readable.fromWeb(
      videoRes.body as import("stream/web").ReadableStream
    );
    const audioNode = Readable.fromWeb(
      audioRes.body as import("stream/web").ReadableStream
    );

    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-i", "pipe:3",   // 영상 스트림
        "-i", "pipe:4",   // 오디오 스트림
        "-c:v", "copy",   // 재인코딩 없이 복사
        "-c:a", "copy",
        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        "-f", "mp4",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"] }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    videoNode.pipe(ffmpeg.stdio[3] as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    audioNode.pipe(ffmpeg.stdio[4] as any);

    ffmpeg.stderr?.on("data", (d: Buffer) => {
      const line = d.toString().split("\n")[0];
      if (line) console.log("[ffmpeg]", line);
    });

    ffmpeg.on("close", (code) => {
      if (code !== 0) console.error(`[ffmpeg] exited ${code}`);
    });

    return new NextResponse(toWebStream(ffmpeg.stdout as Readable), {
      headers: responseHeaders,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("download error:", msg);
    return new NextResponse(`다운로드 오류: ${msg.slice(0, 200)}`, {
      status: 500,
    });
  }
}
