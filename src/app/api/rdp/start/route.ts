import { NextResponse } from "next/server";
import { startGuacamole, waitForGuacamole } from "@/lib/docker";

export async function POST() {
  try {
    await startGuacamole();
    const ready = await waitForGuacamole(30000);

    if (ready) {
      return NextResponse.json({ status: "running" });
    } else {
      return NextResponse.json(
        { status: "starting", message: "Guacamole is starting but not yet ready" },
        { status: 202 }
      );
    }
  } catch (error: any) {
    console.error("RDP start error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to start Guacamole" },
      { status: 500 }
    );
  }
}
