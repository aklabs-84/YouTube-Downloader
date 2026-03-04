import { NextRequest, NextResponse } from "next/server";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import { createReadStream } from "fs";
import { stat, unlink } from "fs/promises";

export const runtime = "nodejs";
export const maxDuration = 300;

const execAsync = promisify(exec);

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
    // ─── Direct 모드: yt-dlp stdout 스트리밍 (낮은 화질, 즉시 시작) ───
    if (mode === "direct") {
      const ytdlp = spawn("yt-dlp", [
        "-f", "best[ext=mp4]/best",
        "--no-warnings",
        "-o", "-",
        watchUrl,
      ]);

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          ytdlp.stdout.on("data", (chunk: Buffer) =>
            controller.enqueue(new Uint8Array(chunk))
          );
          ytdlp.stdout.on("end", () => controller.close());
          ytdlp.on("error", (err) => controller.error(err));
        },
        cancel() { ytdlp.kill(); },
      });

      return new NextResponse(stream, { headers: responseHeaders });
    }

    // ─── Merge 모드: yt-dlp → /tmp 파일 → 스트리밍 ───
    // YouTube DASH URL은 청크 단위로 분할 제공되어 직접 fetch가 불가능.
    // yt-dlp가 내부적으로 Range 요청을 반복해 전체 파일을 /tmp에 저장.
    const tmpFile = `/tmp/${randomUUID()}.mp4`;

    try {
      console.log("[download] yt-dlp 다운로드 시작:", watchUrl);

      await execAsync(
        `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" \
          --merge-output-format mp4 \
          --ffmpeg-location ffmpeg \
          --no-warnings \
          -o "${tmpFile}" \
          "${watchUrl}"`,
        { timeout: 600_000, maxBuffer: 1024 * 100 } // 10분 타임아웃
      );

      console.log("[download] 완료, 스트리밍 시작");

      const { size } = await stat(tmpFile);
      responseHeaders.set("Content-Length", size.toString());

      const fileStream = createReadStream(tmpFile);

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          fileStream.on("data", (chunk) =>
            controller.enqueue(new Uint8Array(chunk as Buffer))
          );
          fileStream.on("end", () => {
            controller.close();
            unlink(tmpFile).catch(() => {});
          });
          fileStream.on("error", (err) => {
            controller.error(err);
            unlink(tmpFile).catch(() => {});
          });
        },
        cancel() {
          fileStream.destroy();
          unlink(tmpFile).catch(() => {});
        },
      });

      return new NextResponse(stream, { headers: responseHeaders });
    } catch (err) {
      await unlink(tmpFile).catch(() => {});
      throw err;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[download] 오류:", msg);
    return new NextResponse(`다운로드 오류: ${msg.slice(0, 300)}`, {
      status: 500,
    });
  }
}
