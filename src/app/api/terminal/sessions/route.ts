import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const WS_SERVER = "http://localhost:3006";

// List all sessions
export async function GET() {
  try {
    const res = await fetch(`${WS_SERVER}/sessions`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: "Terminal server unreachable", sessions: [] }, { status: 502 });
  }
}

// Create a new session
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const res = await fetch(`${WS_SERVER}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: "Terminal server unreachable" }, { status: 502 });
  }
}
