import { NextResponse } from "next/server";
import { mkdir } from "fs/promises";
import { safePath } from "@/lib/files";

export async function POST(request: Request) {
  try {
    const { path } = await request.json();

    if (!path) {
      return NextResponse.json({ error: "Path required" }, { status: 400 });
    }

    const safe = safePath(path);
    await mkdir(safe, { recursive: true });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create directory" },
      { status: error.message?.includes("Access denied") ? 403 : 500 }
    );
  }
}
