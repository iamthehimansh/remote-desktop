import { NextResponse } from "next/server";
import { readApps } from "@/lib/app-store";
import { createConnection } from "net";

export const dynamic = "force-dynamic";

async function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
  });
}

export async function GET() {
  const apps = readApps();

  // Check actual port status for running apps
  const withStatus = await Promise.all(
    apps.map(async (app) => {
      if (app.status === "running" || app.status === "starting") {
        const alive = await checkPort(app.port);
        if (!alive && app.status === "running") {
          return { ...app, status: "stopped" as const, pid: undefined };
        }
      }
      return app;
    })
  );

  return NextResponse.json({ apps: withStatus });
}
