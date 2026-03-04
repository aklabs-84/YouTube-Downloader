"use client";

import { useState } from "react";
import Image from "next/image";

interface VideoInfo {
  title: string;
  thumbnail: string;
  duration: string;
  quality: string;
  width?: number;
  height?: number;
  mode: "merge" | "direct";
  watchUrl: string; // 유튜브 watch URL (CDN URL 아님)
}

type Status = "idle" | "loading" | "ready" | "downloading" | "error";

export default function Home() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const formatDuration = (seconds: string) => {
    const s = parseInt(seconds);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}시간 ${m % 60}분 ${s % 60}초`;
    return `${m}분 ${s % 60}초`;
  };

  const handleExtract = async () => {
    if (!url.trim()) return;
    setStatus("loading");
    setVideoInfo(null);
    setErrorMsg("");

    try {
      const res = await fetch(`/api/info?url=${encodeURIComponent(url.trim())}`);
      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error || "알 수 없는 오류가 발생했습니다.");
        setStatus("error");
        return;
      }

      setVideoInfo(data);
      setStatus("ready");
    } catch {
      setErrorMsg("서버와 통신 중 오류가 발생했습니다.");
      setStatus("error");
    }
  };

  const handleDownload = () => {
    if (!videoInfo) return;
    setStatus("downloading");

    const params = new URLSearchParams({
      url: videoInfo.watchUrl,
      mode: videoInfo.mode,
      title: videoInfo.title,
    });

    const a = document.createElement("a");
    a.href = `/api/download?${params.toString()}`;
    a.download = `${videoInfo.title}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => setStatus("ready"), 3000);
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-red-600 rounded-2xl mb-4 shadow-lg">
            <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M23.495 6.205a3.007 3.007 0 0 0-2.088-2.088c-1.87-.501-9.396-.501-9.396-.501s-7.507-.01-9.396.501A3.007 3.007 0 0 0 .527 6.205a31.247 31.247 0 0 0-.522 5.805 31.247 31.247 0 0 0 .522 5.783 3.007 3.007 0 0 0 2.088 2.088c1.868.502 9.396.502 9.396.502s7.506 0 9.396-.502a3.007 3.007 0 0 0 2.088-2.088 31.247 31.247 0 0 0 .5-5.783 31.247 31.247 0 0 0-.5-5.805zM9.609 15.601V8.408l6.264 3.602z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">YouTube Downloader</h1>
          <p className="text-gray-400 text-sm">최고 화질 MP4로 저장하세요</p>
        </div>

        {/* Input Card */}
        <div className="bg-gray-800 rounded-2xl p-6 shadow-xl border border-gray-700">
          <div className="flex gap-2">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleExtract()}
              placeholder="유튜브 URL을 붙여넣으세요..."
              className="flex-1 bg-gray-700 text-white placeholder-gray-400 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 border border-gray-600"
              disabled={status === "loading" || status === "downloading"}
            />
            <button
              onClick={handleExtract}
              disabled={!url.trim() || status === "loading" || status === "downloading"}
              className="bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold px-5 py-3 rounded-xl transition-colors text-sm whitespace-nowrap"
            >
              {status === "loading" ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  분석 중
                </span>
              ) : "추출"}
            </button>
          </div>

          {/* Error State */}
          {status === "error" && (
            <div className="mt-4 p-4 bg-red-900/40 border border-red-700 rounded-xl">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <p className="text-red-300 text-sm whitespace-pre-line">{errorMsg}</p>
              </div>
            </div>
          )}

          {/* Video Info */}
          {(status === "ready" || status === "downloading") && videoInfo && (
            <div className="mt-5">
              <div className="flex gap-4">
                {videoInfo.thumbnail && (
                  <div className="relative flex-shrink-0 w-32 h-20 rounded-lg overflow-hidden">
                    <Image
                      src={videoInfo.thumbnail}
                      alt={videoInfo.title}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium text-sm leading-snug line-clamp-2 mb-2">
                    {videoInfo.title}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-red-600/30 text-red-300 text-xs font-medium border border-red-600/50">
                      {videoInfo.quality}
                    </span>
                    {videoInfo.width && videoInfo.height && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-700 text-gray-300 text-xs border border-gray-600">
                        {videoInfo.width}×{videoInfo.height}
                      </span>
                    )}
                    {videoInfo.mode === "merge" && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-600/30 text-blue-300 text-xs border border-blue-600/50">
                        HD 병합
                      </span>
                    )}
                    <span className="text-gray-400 text-xs">
                      {formatDuration(videoInfo.duration)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Download Button */}
              <button
                onClick={handleDownload}
                disabled={status === "downloading"}
                className="mt-4 w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {status === "downloading" ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    다운로드 시작 중...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    MP4 다운로드
                  </>
                )}
              </button>

              {/* Merge mode 안내 */}
              {videoInfo.mode === "merge" && (
                <p className="mt-2 text-center text-gray-500 text-xs">
                  영상+오디오 병합 중 — 브라우저 다운로드 창에서 진행률을 확인하세요
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-gray-600 text-xs mt-6">
          저작권 없는 영상 또는 본인 소유 영상에만 사용하세요
        </p>
      </div>
    </main>
  );
}
