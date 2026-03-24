import { readFileSync } from "fs";
import { resolve } from "path";
import { WebSocketServer, WebSocket } from "ws";
import { verify } from "jsonwebtoken";
import { parse as parseCookie } from "cookie";

// Load .env.local manually (tsx/node doesn't auto-load it like Bun)
try {
  const envPath = resolve(process.cwd(), ".env.local");
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/\\(.)/g, "$1");
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
} catch {}

// node-pty is a native module — require() works better than import for it
const pty = require("node-pty");

// Prevent node-pty socket errors from crashing the process
process.on("uncaughtException", (err: any) => {
  if (err.code === "ERR_SOCKET_CLOSED" || err.message?.includes("Socket is closed")) {
    // Expected when PTY is killed while still writing
    return;
  }
  console.error("Uncaught exception:", err);
});

const PORT = 3006;
const JWT_SECRET = process.env.JWT_SECRET || "";

console.log(`JWT_SECRET loaded: ${JWT_SECRET ? "yes (" + JWT_SECRET.length + " chars)" : "NO - auth will fail!"}`);

const SHELLS: Record<string, { command: string; args: string[] }> = {
  powershell: { command: "powershell.exe", args: [] },
  cmd: { command: "cmd.exe", args: [] },
  wsl: { command: "wsl.exe", args: [] },
};

function verifyAuth(req: any): boolean {
  // Allow localhost connections (already behind app auth)
  const origin = req.headers.origin || "";
  const host = req.headers.host || "";
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1") ||
      origin.includes("localhost") || origin.includes("127.0.0.1")) {
    console.log("AUTH: Localhost connection, allowing");
    return true;
  }

  // Check if request came through Cloudflare Access (already authenticated)
  const cfHeader = req.headers["cf-access-authenticated-user-email"];
  if (cfHeader) {
    console.log(`AUTH: Cloudflare Access user: ${cfHeader}`);
    return true;
  }

  // Check for token in query param (production - tunnel may not forward cookies)
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const queryToken = url.searchParams.get("token");
  if (queryToken && JWT_SECRET) {
    try {
      verify(queryToken, JWT_SECRET);
      console.log("AUTH: Query param JWT verified OK");
      return true;
    } catch (err: any) {
      console.log("AUTH: Query param JWT failed:", err.message);
    }
  }

  // Check cookie
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader || !JWT_SECRET) {
    console.log("AUTH: No cookie/token or JWT_SECRET");
    return false;
  }

  try {
    const cookies = parseCookie(cookieHeader);
    const token = cookies["session"];
    if (!token) {
      console.log("AUTH: No 'session' cookie found");
      return false;
    }
    verify(token, JWT_SECRET);
    console.log("AUTH: JWT verified OK");
    return true;
  } catch (err: any) {
    console.log("AUTH: JWT verification failed:", err.message);
    return false;
  }
}

const wss = new WebSocketServer({ port: PORT });

console.log(`Terminal WebSocket server listening on :${PORT}`);

wss.on("connection", (ws: WebSocket, req) => {
  // Auth check
  if (!verifyAuth(req)) {
    console.log("AUTH: Rejecting connection");
    ws.close(4001, "Unauthorized");
    return;
  }

  // Parse shell selection from query string
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const shellName = url.searchParams.get("shell") || "powershell";
  const shellConfig = SHELLS[shellName] || SHELLS.powershell;

  // Spawn PTY
  const ptyProcess = pty.spawn(shellConfig.command, shellConfig.args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: process.env.USERPROFILE || "C:\\Users\\pc",
    env: process.env,
    useConpty: true,
    conptyInheritCursor: false,
  });

  console.log(`PTY spawned: ${shellConfig.command} (pid: ${ptyProcess.pid})`);

  // PTY output -> WebSocket
  ptyProcess.onData((data: string) => {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        console.log(`OUTPUT: ${JSON.stringify(data).slice(0, 80)}`);
        ws.send(JSON.stringify({ type: "output", data }));
      }
    } catch {}
  });

  // PTY exit -> WebSocket
  ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "exit", code: exitCode }));
        ws.close();
      }
    } catch {}
  });

  // WebSocket messages -> PTY
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      switch (msg.type) {
        case "input":
          console.log(`INPUT: ${JSON.stringify(msg.data).slice(0, 50)}`);
          ptyProcess.write(msg.data);
          break;
        case "resize":
          console.log(`RESIZE: ${msg.cols}x${msg.rows}`);
          if (msg.cols && msg.rows) {
            ptyProcess.resize(msg.cols, msg.rows);
          }
          break;
      }
    } catch (err) {
      console.error("Message parse error:", err);
    }
  });

  // Cleanup on WebSocket close
  ws.on("close", () => {
    console.log(`PTY closed (pid: ${ptyProcess.pid})`);
    try {
      ptyProcess.kill();
    } catch {}
  });
});
