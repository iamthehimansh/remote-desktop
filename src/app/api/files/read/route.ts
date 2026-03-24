import { NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { createReadStream } from "fs";
import { basename } from "path";
import { safePath } from "@/lib/files";

export const dynamic = "force-dynamic";

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".js", ".ts", ".tsx", ".jsx", ".css", ".html",
  ".xml", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env",
  ".sh", ".bash", ".bat", ".cmd", ".ps1", ".py", ".rb", ".go", ".rs",
  ".java", ".c", ".cpp", ".h", ".hpp", ".csv", ".sql", ".log", ".gitignore",
  ".svelte", ".vue", ".php", ".swift", ".kt", ".scala", ".r", ".m",
  ".dockerfile", ".makefile", ".gradle", ".properties", ".lock",
]);

const MIME_TYPES: Record<string, string> = {
  // Images
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".bmp": "image/bmp", ".avif": "image/avif",
  // Video
  ".mp4": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo", ".mov": "video/quicktime", ".wmv": "video/x-ms-wmv",
  ".flv": "video/x-flv", ".m4v": "video/mp4", ".ts": "video/mp2t",
  // Audio
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
  ".flac": "audio/flac", ".aac": "audio/aac", ".m4a": "audio/mp4",
  ".wma": "audio/x-ms-wma", ".opus": "audio/opus", ".webm_audio": "audio/webm",
  // PDF
  ".pdf": "application/pdf",
};

const MEDIA_EXTENSIONS = new Set(Object.keys(MIME_TYPES));

const MAX_TEXT_SIZE = 5 * 1024 * 1024; // 5MB

function getMimeType(ext: string): string {
  return MIME_TYPES[ext] || "application/octet-stream";
}

function isMediaFile(ext: string): boolean {
  return MEDIA_EXTENSIONS.has(ext);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get("path");
  const download = searchParams.get("download") === "true";
  const stream = searchParams.get("stream") === "true";

  if (!filePath) {
    return NextResponse.json({ error: "Path required" }, { status: 400 });
  }

  try {
    const safe = safePath(filePath);
    const stats = await stat(safe);

    if (stats.isDirectory()) {
      return NextResponse.json({ error: "Cannot read a directory" }, { status: 400 });
    }

    const name = basename(safe);
    const ext = name.includes(".") ? "." + name.split(".").pop()!.toLowerCase() : "";
    const mimeType = getMimeType(ext);
    const isText = TEXT_EXTENSIONS.has(ext);
    const isMedia = isMediaFile(ext);

    // Force download
    if (download) {
      const content = await readFile(safe);
      return new Response(content, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${name}"`,
          "Content-Length": String(stats.size),
        },
      });
    }

    // Stream media with range support (for seeking in video/audio)
    if (stream || isMedia) {
      const rangeHeader = request.headers.get("range");

      if (rangeHeader) {
        // Parse range header
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1]);
          const end = match[2] ? parseInt(match[2]) : stats.size - 1;
          const chunkSize = end - start + 1;

          const nodeStream = createReadStream(safe, { start, end });
          const webStream = new ReadableStream({
            start(controller) {
              nodeStream.on("data", (chunk) => controller.enqueue(chunk));
              nodeStream.on("end", () => controller.close());
              nodeStream.on("error", (err) => controller.error(err));
            },
            cancel() {
              nodeStream.destroy();
            },
          });

          return new Response(webStream, {
            status: 206,
            headers: {
              "Content-Type": mimeType,
              "Content-Range": `bytes ${start}-${end}/${stats.size}`,
              "Content-Length": String(chunkSize),
              "Accept-Ranges": "bytes",
            },
          });
        }
      }

      // Full file response for media (no range requested)
      const content = await readFile(safe);
      return new Response(content, {
        headers: {
          "Content-Type": mimeType,
          "Content-Length": String(stats.size),
          "Accept-Ranges": "bytes",
        },
      });
    }

    // Text file — return as JSON
    if (isText && stats.size <= MAX_TEXT_SIZE) {
      const content = await readFile(safe, "utf-8");
      return NextResponse.json({ content, encoding: "utf-8", size: stats.size });
    }

    // Fallback: download
    const content = await readFile(safe);
    return new Response(content, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Content-Length": String(stats.size),
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to read file" },
      { status: 500 }
    );
  }
}
