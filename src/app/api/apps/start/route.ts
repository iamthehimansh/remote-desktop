import { NextResponse } from "next/server";
import { getApp, updateApp } from "@/lib/app-store";
import { createDNSRecord } from "@/lib/cloudflare";
import { addIngressRule } from "@/lib/tunnel-config";
import { exec } from "child_process";
import { randomBytes } from "crypto";
import { createConnection } from "net";

export const dynamic = "force-dynamic";

async function waitForPort(port: number, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const alive = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ port, host: "127.0.0.1" }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
      socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
    });
    if (alive) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export async function POST(request: Request) {
  try {
    const { id } = await request.json();
    const app = getApp(id);

    if (!app) {
      return NextResponse.json({ error: "App not found" }, { status: 404 });
    }

    if (app.status === "running") {
      return NextResponse.json({ error: "App already running" }, { status: 400 });
    }

    // Use user-set password or generate a random one
    const appToken = app.password || randomBytes(24).toString("hex");

    // Build command with substitutions
    let cmd = app.command
      .replace(/\{port\}/g, String(app.port))
      .replace(/\{token\}/g, appToken)
      .replace(/\{password\}/g, appToken)
      .replace(/\{username\}/g, app.username || "admin");

    updateApp(id, { status: "starting" });

    // Start the process
    const child = exec(cmd, {
      env: { ...process.env, ...app.envVars },
      windowsHide: true,
    });

    child.unref();
    const pid = child.pid;

    // Set up DNS + tunnel ingress
    const hostname = `${app.subdomain}.himansh.in`;
    let dnsRecordId = app.dnsRecordId;

    if (!dnsRecordId) {
      try {
        const dns = await createDNSRecord(app.subdomain);
        dnsRecordId = dns.id;
      } catch (err: any) {
        // DNS might already exist
        if (!err.message?.includes("already exists")) {
          console.warn("DNS creation failed:", err.message);
        }
      }
    }

    // Add ingress rule
    try {
      await addIngressRule(hostname, app.port, "http");
    } catch (err) {
      console.warn("Ingress rule failed:", err);
    }

    // Wait for app to be ready
    const ready = await waitForPort(app.port, 20000);

    const url = `https://${hostname}`;

    updateApp(id, {
      status: ready ? "running" : "starting",
      pid,
      dnsRecordId,
      url,
    });

    return NextResponse.json({
      status: ready ? "running" : "starting",
      url,
      token: appToken,
      pid,
    });
  } catch (error: any) {
    console.error("App start error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to start app" },
      { status: 500 }
    );
  }
}
