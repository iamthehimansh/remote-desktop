import { NextResponse } from "next/server";

const CONTROL_URL = `http://127.0.0.1:${process.env.TUNNEL_CONTROL_PORT || 8091}`;

export async function DELETE(request: Request) {
  try {
    const { name } = await request.json();
    if (!name) return NextResponse.json({ error: "Tunnel name required" }, { status: 400 });

    const res = await fetch(`${CONTROL_URL}/tunnels/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return NextResponse.json({ error: data.error || "Failed to remove tunnel" }, { status: res.status });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to remove tunnel" }, { status: 500 });
  }
}
