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
    // ─── Direct 모드: yt-dlp stdout 스트리밍 (즉시 시작) ───
    if (mode === "direct") {
      const ytdlp = spawn("yt-dlp", [
        "-f", "best[ext=mp4]/best",
        "--quiet",
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
    // 출력 템플릿에 %(ext)s를 사용해야 yt-dlp가 정확한 경로에 파일을 생성
    const uid = randomUUID();
    const tmpBase = `/tmp/ytdl_${uid}`;
    const tmpFile = `${tmpBase}.mp4`;

    const cookiesFlag = process.env.YOUTUBE_COOKIES
      ? '--cookies /tmp/yt-cookies.txt'
      : '';

    console.log("[download] 시작:", watchUrl);

    const { stderr } = await execAsync(
      `yt-dlp \
        -f "bestvideo+bestaudio/best" \
        --merge-output-format mp4 \
        --ffmpeg-location /usr/bin/ffmpeg \
        --quiet \
        ${cookiesFlag} \
        -o "${tmpBase}.%(ext)s" \
        "${watchUrl}"`,
      { timeout: 600_000, maxBuffer: 10 * 1024 * 1024 }
    );

    if (stderr) console.log("[yt-dlp stderr]", stderr.slice(0, 500));

    // 파일 존재 확인
    const { size } = await stat(tmpFile);
    console.log("[download] 완료:", tmpFile, `(${(size / 1024 / 1024).toFixed(1)}MB)`);

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
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[download] 오류:", msg);
    return new NextResponse(`다운로드 오류: ${msg.slice(0, 300)}`, { status: 500 });
  }
}
