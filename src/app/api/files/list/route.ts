import { NextResponse } from "next/server";
import { readdir, stat } from "fs/promises";
import { join, dirname, extname, normalize } from "path";
import { safePath, getFileManagerRoot, getDrives } from "@/lib/files";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedPath = searchParams.get("path");

  // If no path or "drives" requested, show available drives
  if (!requestedPath || requestedPath === "drives") {
    const drives = await getDrives();
    const items = drives.map((d) => ({
      name: d.replace("\\", ""),
      type: "directory" as const,
      size: 0,
      modified: null,
      extension: null,
    }));
    return NextResponse.json({ path: "drives", parent: null, items });
  }

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

    // Parent: go up one level, or back to drives list for root of a drive
    const normalized = normalize(dirPath);
    const parentDir = dirname(normalized);
    const parent = parentDir === normalized ? "drives" : parentDir;

    return NextResponse.json({ path: dirPath, parent, items });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to list directory" },
      { status: 500 }
    );
  }
}
