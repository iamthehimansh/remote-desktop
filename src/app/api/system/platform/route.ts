import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Lightweight endpoint so the client can pick OS-appropriate shells, etc.
export async function GET() {
  return NextResponse.json({ platform: process.platform });
}
