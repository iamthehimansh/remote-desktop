import { NextResponse } from "next/server";
import { rm } from "fs/promises";
import { safePath } from "@/lib/files";

export async function DELETE(request: Request) {
  try {
    const { paths } = await request.json();

    if (!Array.isArray(paths) || paths.length === 0) {
      return NextResponse.json({ error: "Paths array required" }, { status: 400 });
    }

    for (const p of paths) {
      const safe = safePath(p);
      await rm(safe, { recursive: true, force: true });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Delete failed" },
      { status: error.message?.includes("Access denied") ? 403 : 500 }
    );
  }
}
