import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CONTROL_URL = `http://127.0.0.1:${process.env.TUNNEL_CONTROL_PORT || 8091}`;

export async function GET() {
  try {
    const res = await fetch(`${CONTROL_URL}/tunnels`, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ tunnels: [] });
    const data = await res.json();
    return NextResponse.json({ tunnels: data.tunnels || [] });
  } catch {
    // Tunnel server not running / unreachable.
    return NextResponse.json({ tunnels: [], error: "tunnel-server-unreachable" });
  }
}
