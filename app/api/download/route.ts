import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { Readable } from "stream";
import ytdl from "@distube/ytdl-core";

export const runtime = "nodejs";
export const maxDuration = 300;

// Node.js Readable → Web ReadableStream 변환
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

  if (!watchUrl) {
    return new NextResponse("URL이 필요합니다.", { status: 400 });
  }

  // 유튜브 watch URL만 허용
  if (!watchUrl.startsWith("https://www.youtube.com/watch?v=")) {
    return new NextResponse("허용되지 않은 URL입니다.", { status: 403 });
  }

  const safeTitle = title.replace(/[<>:"/\\|?*]/g, "").trim() || "video";
  const headers = new Headers({
    "Content-Type": "video/mp4",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeTitle)}.mp4`,
  });

  try {
    const info = await ytdl.getInfo(watchUrl);

    // --- Direct 모드: 통합(progressive) 스트림 직접 전송 ---
    if (mode === "direct") {
      const stream = ytdl.downloadFromInfo(info, {
        quality: "highestvideo",
        filter: "audioandvideo",
      });
      return new NextResponse(toWebStream(stream), { headers });
    }

    // --- Merge 모드: ytdl 스트림 → ffmpeg 파이프 → 병합 출력 ---
    const videoStream = ytdl.downloadFromInfo(info, {
      quality: "highestvideo",
      filter: (f) => f.hasVideo && !f.hasAudio && f.container === "mp4",
    });

    const audioStream = ytdl.downloadFromInfo(info, {
      quality: "highestaudio",
      filter: (f) =>
        !f.hasVideo &&
        f.hasAudio &&
        (f.container === "mp4" || !!f.mimeType?.startsWith("audio/mp4")),
    });

    // ffmpeg: pipe:3(영상) + pipe:4(오디오) → pipe:1(stdout)
    // stdio 배열: [stdin, stdout, stderr, videoIn, audioIn]
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-i", "pipe:3",
        "-i", "pipe:4",
        "-c:v", "copy",  // 영상 그대로 복사 (재인코딩 없음, 빠름)
        "-c:a", "copy",  // 오디오 그대로 복사 (M4A → AAC 이미 호환)
        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        "-f", "mp4",
        "pipe:1",
      ],
      {
        stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
      }
    );

    // ytdl 스트림 → ffmpeg 파이프 연결
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    videoStream.pipe(ffmpeg.stdio[3] as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    audioStream.pipe(ffmpeg.stdio[4] as any);

    ffmpeg.stderr?.on("data", (d: Buffer) => {
      const line = d.toString().split("\n")[0];
      if (line) console.log("[ffmpeg]", line);
    });

    ffmpeg.on("close", (code) => {
      if (code !== 0) console.error(`[ffmpeg] exited with code ${code}`);
    });

    return new NextResponse(toWebStream(ffmpeg.stdout as Readable), { headers });
  } catch (err) {
    console.error("download error:", err);
    return new NextResponse("다운로드 중 오류가 발생했습니다.", { status: 500 });
  }
}
