import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";

export const runtime = "nodejs";
export const maxDuration = 300; // 5분 (Railway는 제한 없음)

function isAllowedYouTubeCDN(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.hostname.endsWith("googlevideo.com") ||
      parsed.hostname.endsWith("youtube.com")
    );
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const videoUrl = req.nextUrl.searchParams.get("videoUrl");
  const audioUrl = req.nextUrl.searchParams.get("audioUrl"); // null이면 direct 모드
  const title = req.nextUrl.searchParams.get("title") || "video";

  if (!videoUrl) {
    return new NextResponse("URL이 필요합니다.", { status: 400 });
  }

  if (!isAllowedYouTubeCDN(videoUrl)) {
    return new NextResponse("허용되지 않은 URL입니다.", { status: 403 });
  }

  const safeTitle = title.replace(/[<>:"/\\|?*]/g, "").trim() || "video";

  const headers = new Headers({
    "Content-Type": "video/mp4",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeTitle)}.mp4`,
  });

  // --- Direct 모드: ffmpeg 없이 YouTube CDN 직접 프록시 ---
  if (!audioUrl) {
    const response = await fetch(videoUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://www.youtube.com/",
      },
    });
    if (!response.ok || !response.body) {
      return new NextResponse("영상을 가져오지 못했습니다.", {
        status: response.status,
      });
    }
    const contentLength = response.headers.get("Content-Length");
    if (contentLength) headers.set("Content-Length", contentLength);
    return new NextResponse(response.body, { headers });
  }

  // --- Merge 모드: ffmpeg로 영상 + 오디오 병합 ---
  if (!isAllowedYouTubeCDN(audioUrl)) {
    return new NextResponse("허용되지 않은 오디오 URL입니다.", { status: 403 });
  }

  // ffmpeg: 두 URL을 직접 입력받아 합친 뒤 stdout으로 출력
  // -movflags: 파일 헤더 없이 스트리밍 가능한 fragmented MP4로 출력
  const ffmpegArgs = [
    "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "-headers", "Referer: https://www.youtube.com/\r\n",
    "-i", videoUrl,
    "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "-headers", "Referer: https://www.youtube.com/\r\n",
    "-i", audioUrl,
    "-c:v", "copy",      // 영상 재인코딩 없이 그대로 복사 (빠름)
    "-c:a", "aac",       // 오디오 AAC로 인코딩 (호환성)
    "-movflags", "frag_keyframe+empty_moov+default_base_moof",
    "-f", "mp4",
    "pipe:1",            // stdout으로 출력
  ];

  const ffmpeg = spawn("ffmpeg", ffmpegArgs);

  const stream = new ReadableStream({
    start(controller) {
      ffmpeg.stdout.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      ffmpeg.stdout.on("end", () => {
        controller.close();
      });
      ffmpeg.stderr.on("data", (data: Buffer) => {
        // ffmpeg는 진행 상황을 stderr로 출력 — 로그만 남김
        console.log("[ffmpeg]", data.toString().split("\n")[0]);
      });
      ffmpeg.on("error", (err) => {
        console.error("ffmpeg spawn error:", err);
        controller.error(err);
      });
      ffmpeg.on("close", (code) => {
        if (code !== 0) {
          console.error(`ffmpeg exited with code ${code}`);
        }
      });
    },
    cancel() {
      ffmpeg.kill("SIGTERM");
    },
  });

  return new NextResponse(stream, { headers });
}
