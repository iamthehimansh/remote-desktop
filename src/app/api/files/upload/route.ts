import { NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import { join } from "path";
import { safePath } from "@/lib/files";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const targetPath = formData.get("path") as string;

    if (!targetPath) {
      return NextResponse.json({ error: "Target path required" }, { status: 400 });
    }

    const dirPath = safePath(targetPath);
    const savedFiles: string[] = [];

    for (const [key, value] of formData.entries()) {
      if (key === "path") continue;
      if (value instanceof File) {
        const buffer = Buffer.from(await value.arrayBuffer());
        const filePath = join(dirPath, value.name);
        safePath(filePath); // Validate the final path
        await writeFile(filePath, buffer);
        savedFiles.push(filePath);
      }
    }

    return NextResponse.json({ success: true, files: savedFiles });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Upload failed" },
      { status: error.message?.includes("Access denied") ? 403 : 500 }
    );
  }
}
