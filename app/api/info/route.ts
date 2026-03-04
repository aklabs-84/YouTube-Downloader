import { NextRequest, NextResponse } from "next/server";
import ytdl from "@distube/ytdl-core";

export const runtime = "nodejs";
export const maxDuration = 30;

function normalizeYouTubeUrl(rawUrl: string): string | null {
  try {
    const videoId = ytdl.getURLVideoID(rawUrl);
    return `https://www.youtube.com/watch?v=${videoId}`;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get("url");

  if (!rawUrl) {
    return NextResponse.json({ error: "URL이 필요합니다." }, { status: 400 });
  }

  const normalizedUrl = normalizeYouTubeUrl(rawUrl.trim());
  if (!normalizedUrl) {
    return NextResponse.json(
      {
        error:
          "유효하지 않은 유튜브 URL입니다.\n유튜브 영상 또는 공유 링크를 붙여넣으세요.",
      },
      { status: 400 }
    );
  }

  try {
    const info = await ytdl.getInfo(normalizedUrl);
    const formats = info.formats;

    // 1) 영상 전용(video-only) MP4 포맷 — 높은 해상도 우선
    const videoOnlyFormats = formats
      .filter(
        (f) =>
          f.hasVideo &&
          !f.hasAudio &&
          f.container === "mp4" &&
          f.url
      )
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

    // 2) 오디오 전용(audio-only) M4A 포맷 — 높은 비트레이트 우선
    const audioOnlyFormats = formats
      .filter(
        (f) =>
          !f.hasVideo &&
          f.hasAudio &&
          (f.container === "mp4" ||
            f.mimeType?.startsWith("audio/mp4")) &&
          f.url
      )
      .sort((a, b) => (b.audioBitrate ?? 0) - (a.audioBitrate ?? 0));

    // 3) 통합(progressive) MP4 포맷 — fallback용
    const progressiveFormats = formats
      .filter(
        (f) => f.hasVideo && f.hasAudio && f.container === "mp4" && f.url
      )
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

    const bestVideo = videoOnlyFormats[0];
    const bestAudio = audioOnlyFormats[0];
    const bestProgressive = progressiveFormats[0];

    // ffmpeg 병합 가능한 경우 (영상 + 오디오 분리 스트림)
    if (bestVideo && bestAudio) {
      const height = bestVideo.height ?? 0;
      const qualityLabel =
        height >= 1080
          ? "1080p"
          : height >= 720
          ? "720p"
          : height >= 480
          ? "480p"
          : `${height}p`;

      return NextResponse.json({
        title: info.videoDetails.title,
        thumbnail:
          info.videoDetails.thumbnails[
            info.videoDetails.thumbnails.length - 1
          ]?.url,
        duration: info.videoDetails.lengthSeconds,
        quality: qualityLabel,
        width: bestVideo.width,
        height: bestVideo.height,
        mode: "merge", // ffmpeg 병합 필요
        videoUrl: bestVideo.url,
        audioUrl: bestAudio.url,
      });
    }

    // fallback: progressive (영상+오디오 통합본)
    if (bestProgressive) {
      const height = bestProgressive.height ?? 0;
      const qualityLabel =
        height >= 720 ? "720p" : height >= 480 ? "480p" : `${height}p`;

      return NextResponse.json({
        title: info.videoDetails.title,
        thumbnail:
          info.videoDetails.thumbnails[
            info.videoDetails.thumbnails.length - 1
          ]?.url,
        duration: info.videoDetails.lengthSeconds,
        quality: qualityLabel,
        width: bestProgressive.width,
        height: bestProgressive.height,
        mode: "direct", // 직접 다운로드
        videoUrl: bestProgressive.url,
        audioUrl: null,
      });
    }

    return NextResponse.json(
      { error: "다운로드 가능한 포맷을 찾지 못했습니다." },
      { status: 404 }
    );
  } catch (err) {
    console.error("ytdl error:", err);
    return NextResponse.json(
      {
        error:
          "영상 정보를 가져오지 못했습니다. 비공개 영상이거나 유튜브 정책 변경일 수 있습니다.",
      },
      { status: 500 }
    );
  }
}
