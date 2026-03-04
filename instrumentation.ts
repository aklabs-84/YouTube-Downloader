export async function register() {
  // Node.js 런타임에서만 실행 (Edge Runtime 제외)
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // 클라이언트가 다운로드 도중 연결을 끊으면 ECONNRESET이 발생.
  // 이를 잡지 않으면 Railway가 컨테이너를 재시작함.
  process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
    if (err.code === "ECONNRESET" || err.code === "EPIPE") {
      return; // 정상적인 클라이언트 연결 끊김 — 무시
    }
    console.error("uncaughtException:", err);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("unhandledRejection:", reason);
  });
}
