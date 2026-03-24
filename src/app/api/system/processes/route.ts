import { NextResponse } from "next/server";
import { getProcesses } from "@/lib/system-info";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const processes = await getProcesses();
    return NextResponse.json(processes);
  } catch (error) {
    console.error("Process list error:", error);
    return NextResponse.json(
      { error: "Failed to get processes" },
      { status: 500 }
    );
  }
}
