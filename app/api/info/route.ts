import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

export const runtime = "nodejs";
export const maxDuration = 30;

const execAsync = promisify(exec);

// video ID만 추출해 정규 watch URL 반환
function normalizeYouTubeUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl.trim());

    // youtu.be/VIDEO_ID
    if (url.hostname === "youtu.be") {
      const id = url.pathname.slice(1);
      if (id) return `https://www.youtube.com/watch?v=${id}`;
    }

    // youtube.com/watch?v=VIDEO_ID
    if (
      url.hostname.endsWith("youtube.com") &&
      url.pathname === "/watch"
    ) {
      const id = url.searchParams.get("v");
      if (id) return `https://www.youtube.com/watch?v=${id}`;
    }

    // youtube.com/shorts/VIDEO_ID
    if (
      url.hostname.endsWith("youtube.com") &&
      url.pathname.startsWith("/shorts/")
    ) {
      const id = url.pathname.split("/")[2];
      if (id) return `https://www.youtube.com/watch?v=${id}`;
    }

    return null;
  } catch {
    return null;
  }
}

interface YtDlpFormat {
  ext: string;
  height?: number;
  width?: number;
  vcodec?: string;
  acodec?: string;
  abr?: number;
  url?: string;
}

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get("url");

  if (!rawUrl) {
    return NextResponse.json({ error: "URL이 필요합니다." }, { status: 400 });
  }

  const watchUrl = normalizeYouTubeUrl(rawUrl);
  if (!watchUrl) {
    return NextResponse.json(
      {
        error:
          "유효하지 않은 유튜브 URL입니다.\n유튜브 영상 또는 공유 링크를 붙여넣으세요.",
      },
      { status: 400 }
    );
  }

  // 쿠키 파일이 있으면 --cookies 플래그 추가 (봇 감지 우회)
  const cookiesFlag = process.env.YOUTUBE_COOKIES
    ? '--cookies /tmp/yt-cookies.txt'
    : '';

  try {
    const { stdout } = await execAsync(
      `yt-dlp --dump-json --no-playlist --no-warnings --no-check-formats ${cookiesFlag} "${watchUrl}"`,
      { maxBuffer: 10 * 1024 * 1024 }
    );

    const data = JSON.parse(stdout);
    const formats: YtDlpFormat[] = data.formats || [];

    // 영상 전용 (포맷 무관, 높은 해상도 우선)
    const videoOnly = formats
      .filter((f) => f.vcodec !== "none" && f.vcodec && f.acodec === "none" && f.url)
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

    // 오디오 전용 (포맷 무관, 높은 비트레이트 우선)
    const audioOnly = formats
      .filter((f) => f.vcodec === "none" && f.acodec !== "none" && f.acodec && f.url)
      .sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0));

    // 통합 스트림 fallback (포맷 무관)
    const progressive = formats
      .filter((f) => f.vcodec !== "none" && f.vcodec && f.acodec !== "none" && f.acodec && f.url)
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

    const bestVideo = videoOnly[0];
    const bestAudio = audioOnly[0];
    const bestProgressive = progressive[0];

    if (bestVideo && bestAudio) {
      const h = bestVideo.height ?? 0;
      const quality =
        h >= 1080 ? "1080p" : h >= 720 ? "720p" : h >= 480 ? "480p" : `${h}p`;

      return NextResponse.json({
        title: data.title,
        thumbnail: data.thumbnail,
        duration: String(data.duration ?? 0),
        quality,
        width: bestVideo.width,
        height: bestVideo.height,
        mode: "merge",
        watchUrl,
      });
    }

    if (bestProgressive) {
      const h = bestProgressive.height ?? 0;
      const quality =
        h >= 720 ? "720p" : h >= 480 ? "480p" : `${h}p`;

      return NextResponse.json({
        title: data.title,
        thumbnail: data.thumbnail,
        duration: String(data.duration ?? 0),
        quality,
        width: bestProgressive.width,
        height: bestProgressive.height,
        mode: "direct",
        watchUrl,
      });
    }

    return NextResponse.json(
      { error: "다운로드 가능한 포맷을 찾지 못했습니다." },
      { status: 404 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("yt-dlp info error:", msg);
    return NextResponse.json(
      { error: `영상 정보를 가져오지 못했습니다.\n${msg.slice(0, 200)}` },
      { status: 500 }
    );
  }
}
