import { NextResponse } from "next/server";
import { getDrives } from "@/lib/files";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const drives = await getDrives();
    return NextResponse.json({ drives });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
