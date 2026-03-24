import { NextResponse } from "next/server";
import { getGuacamoleStatus } from "@/lib/docker";

export const dynamic = "force-dynamic";

export async function GET() {
  const running = await getGuacamoleStatus();
  return NextResponse.json({ running });
}
