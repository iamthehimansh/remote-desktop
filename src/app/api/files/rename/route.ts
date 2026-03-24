import { NextResponse } from "next/server";
import { rename } from "fs/promises";
import { safePath } from "@/lib/files";

export async function PATCH(request: Request) {
  try {
    const { oldPath, newPath } = await request.json();

    if (!oldPath || !newPath) {
      return NextResponse.json({ error: "oldPath and newPath required" }, { status: 400 });
    }

    const safeOld = safePath(oldPath);
    const safeNew = safePath(newPath);
    await rename(safeOld, safeNew);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Rename failed" },
      { status: error.message?.includes("Access denied") ? 403 : 500 }
    );
  }
}
