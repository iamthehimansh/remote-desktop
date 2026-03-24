import { NextResponse } from "next/server";
import { readdir, stat } from "fs/promises";
import { join, dirname, extname } from "path";
import { safePath, getFileManagerRoot } from "@/lib/files";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedPath = searchParams.get("path") || getFileManagerRoot();

  try {
    const dirPath = safePath(requestedPath);
    const entries = await readdir(dirPath, { withFileTypes: true });

    const items = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = join(dirPath, entry.name);
        try {
          const stats = await stat(fullPath);
          return {
            name: entry.name,
            type: entry.isDirectory() ? "directory" : "file",
            size: stats.size,
            modified: stats.mtime.toISOString(),
            extension: entry.isFile() ? extname(entry.name).toLowerCase() : null,
          };
        } catch {
          return {
            name: entry.name,
            type: entry.isDirectory() ? "directory" : "file",
            size: 0,
            modified: null,
            extension: entry.isFile() ? extname(entry.name).toLowerCase() : null,
          };
        }
      })
    );

    // Sort: directories first, then alphabetically
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const root = getFileManagerRoot();
    const parent = dirPath === root ? null : dirname(dirPath);

    return NextResponse.json({ path: dirPath, parent, items });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to list directory" },
      { status: error.message?.includes("Access denied") ? 403 : 500 }
    );
  }
}
