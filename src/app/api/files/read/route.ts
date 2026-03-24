import { NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { basename } from "path";
import { safePath } from "@/lib/files";

export const dynamic = "force-dynamic";

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".js", ".ts", ".tsx", ".jsx", ".css", ".html",
  ".xml", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env",
  ".sh", ".bash", ".bat", ".cmd", ".ps1", ".py", ".rb", ".go", ".rs",
  ".java", ".c", ".cpp", ".h", ".hpp", ".csv", ".sql", ".log", ".gitignore",
]);

const MAX_TEXT_SIZE = 5 * 1024 * 1024; // 5MB

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get("path");
  const download = searchParams.get("download") === "true";

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
    const isText = TEXT_EXTENSIONS.has(ext);

    if (download || !isText || stats.size > MAX_TEXT_SIZE) {
      const content = await readFile(safe);
      return new Response(content, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${name}"`,
          "Content-Length": String(stats.size),
        },
      });
    }

    const content = await readFile(safe, "utf-8");
    return NextResponse.json({ content, encoding: "utf-8", size: stats.size });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to read file" },
      { status: error.message?.includes("Access denied") ? 403 : 500 }
    );
  }
}
