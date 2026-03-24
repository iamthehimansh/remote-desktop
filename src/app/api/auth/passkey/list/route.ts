import { NextResponse } from "next/server";
import { getPasskeys } from "@/lib/auth-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const passkeys = getPasskeys().map((p) => ({
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    transports: p.transports,
  }));

  return NextResponse.json({ passkeys });
}
