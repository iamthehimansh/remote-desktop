import { NextResponse } from "next/server";
import { stopGuacamole } from "@/lib/docker";

export async function POST() {
  try {
    await stopGuacamole();
    return NextResponse.json({ status: "stopped" });
  } catch (error: any) {
    console.error("RDP stop error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to stop Guacamole" },
      { status: 500 }
    );
  }
}
