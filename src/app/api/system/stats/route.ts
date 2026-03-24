import { NextResponse } from "next/server";
import { getSystemStats } from "@/lib/system-info";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = await getSystemStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.error("System stats error:", error);
    return NextResponse.json(
      { error: "Failed to get system stats" },
      { status: 500 }
    );
  }
}
