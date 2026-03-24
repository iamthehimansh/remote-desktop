import { NextResponse } from "next/server";
import { getApp, updateApp } from "@/lib/app-store";
import { removeIngressRule } from "@/lib/tunnel-config";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { id } = await request.json();
    const app = getApp(id);

    if (!app) {
      return NextResponse.json({ error: "App not found" }, { status: 404 });
    }

    // Kill the process
    if (app.pid) {
      try {
        await execAsync(`taskkill /PID ${app.pid} /T /F`);
      } catch {
        // Process might already be dead
      }
    }

    // Also kill by port as fallback
    try {
      const { stdout } = await execAsync(`netstat -ano | findstr :${app.port} | findstr LISTENING`);
      const lines = stdout.trim().split("\n");
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== "0") {
          await execAsync(`taskkill /PID ${pid} /T /F`).catch(() => {});
        }
      }
    } catch {
      // No process found on port
    }

    // Remove ingress rule (keep DNS for faster restart)
    try {
      const hostname = `${app.subdomain}.himansh.in`;
      await removeIngressRule(hostname);
    } catch (err) {
      console.warn("Ingress removal failed:", err);
    }

    updateApp(id, { status: "stopped", pid: undefined });

    return NextResponse.json({ status: "stopped" });
  } catch (error: any) {
    console.error("App stop error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to stop app" },
      { status: 500 }
    );
  }
}
