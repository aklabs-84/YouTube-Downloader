import { writeFile } from "fs/promises";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // YouTube 쿠키 파일 생성 (Railway 환경변수 → /tmp 파일)
  if (process.env.YOUTUBE_COOKIES) {
    try {
      const content = Buffer.from(
        process.env.YOUTUBE_COOKIES,
        "base64"
      ).toString("utf-8");
      await writeFile("/tmp/yt-cookies.txt", content, "utf-8");
      console.log("[startup] YouTube 쿠키 로드 완료");
    } catch (err) {
      console.error("[startup] 쿠키 파일 생성 실패:", err);
    }
  } else {
    console.warn("[startup] YOUTUBE_COOKIES 환경변수 없음 — 봇 감지 우회 불가");
  }

  // ECONNRESET / EPIPE는 클라이언트가 다운로드 중 연결 끊은 것 — 컨테이너 재시작 방지
  process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
    if (err.code === "ECONNRESET" || err.code === "EPIPE") return;
    console.error("uncaughtException:", err);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("unhandledRejection:", reason);
  });
}
