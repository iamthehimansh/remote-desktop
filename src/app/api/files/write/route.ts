import { NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import { safePath } from "@/lib/files";

export async function POST(request: Request) {
  try {
    const { path, content } = await request.json();

    if (!path || content === undefined) {
      return NextResponse.json({ error: "Path and content required" }, { status: 400 });
    }

    const safe = safePath(path);
    await writeFile(safe, content, "utf-8");

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Write failed" },
      { status: error.message?.includes("Access denied") ? 403 : 500 }
    );
  }
}
