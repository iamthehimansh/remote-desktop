import { readFileSync, writeFileSync, createWriteStream, createReadStream, unlinkSync, existsSync, mkdirSync, readdirSync, statSync, WriteStream } from "fs";
import { resolve, join } from "path";
import { WebSocketServer, WebSocket } from "ws";
import { verify } from "jsonwebtoken";
import { parse as parseCookie } from "cookie";
import { randomBytes } from "crypto";

// Load .env.local manually (tsx/node doesn't auto-load it like Bun does)
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

// Prevent node-pty socket errors from crashing the process
process.on("uncaughtException", (err: any) => {
  if (err.code === "ERR_SOCKET_CLOSED" || err.message?.includes("Socket is closed")) return;
  console.error("Uncaught exception:", err);
});

// node-pty is a native module — require() works better than import for it
const pty = require("node-pty");

const PORT = 3006;
const JWT_SECRET = process.env.JWT_SECRET || "";
const SESSIONS_DIR = resolve(process.cwd(), "data/terminal-sessions");
const METADATA_PATH = join(SESSIONS_DIR, "sessions.json");
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 min

if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });

console.log(`JWT_SECRET loaded: ${JWT_SECRET ? "yes (" + JWT_SECRET.length + " chars)" : "NO - auth will fail!"}`);

const SHELLS: Record<string, { command: string; args: string[] }> = {
  powershell: { command: "powershell.exe", args: [] },
  "powershell-admin": { command: "powershell.exe", args: ["-ExecutionPolicy", "Bypass"] },
  cmd: { command: "cmd.exe", args: ["/K", "title Admin CMD"] },
  wsl: { command: "wsl.exe", args: [] },
};

// ---------- Session metadata persistence ----------
interface SessionMeta {
  id: string;
  shell: string;
  title: string;
  createdAt: string;
  ttlMs: number | "unlimited";
  lastActive: string;
}

function readMetadata(): Record<string, SessionMeta> {
  if (!existsSync(METADATA_PATH)) return {};
  try { return JSON.parse(readFileSync(METADATA_PATH, "utf-8")); } catch { return {}; }
}
function writeMetadata(data: Record<string, SessionMeta>) {
  writeFileSync(METADATA_PATH, JSON.stringify(data, null, 2));
}
function updateMeta(id: string, patch: Partial<SessionMeta>) {
  const meta = readMetadata();
  if (meta[id]) {
    meta[id] = { ...meta[id], ...patch };
    writeMetadata(meta);
  }
}

// ---------- Live session state ----------
interface Session {
  id: string;
  shell: string;
  title: string;
  pty: any;
  logStream: WriteStream;
  logPath: string;
  clients: Set<WebSocket>;
  ttlTimer: NodeJS.Timeout | null;
  ttlMs: number | "unlimited";
  createdAt: number;
  cols: number;
  rows: number;
}

const sessions = new Map<string, Session>();

function logPathFor(id: string) { return join(SESSIONS_DIR, `${id}.log`); }

const SHELL_TITLES: Record<string, string> = {
  powershell: "PowerShell",
  "powershell-admin": "PowerShell (Admin)",
  cmd: "CMD",
  wsl: "WSL",
};

function createSession(shell: string, sessionId?: string, title?: string): Session {
  const id = sessionId || randomBytes(8).toString("hex");
  const shellConfig = SHELLS[shell] || SHELLS.powershell;
  const sessionTitle = title || SHELL_TITLES[shell] || shell;

  const ptyProcess = pty.spawn(shellConfig.command, shellConfig.args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: process.env.USERPROFILE || "C:\\Users\\pc",
    env: process.env,
    useConpty: true,
    conptyInheritCursor: false,
  });

  const logPath = logPathFor(id);
  const logStream = createWriteStream(logPath, { flags: "a" });

  const session: Session = {
    id,
    shell,
    title: sessionTitle,
    pty: ptyProcess,
    logStream,
    logPath,
    clients: new Set(),
    ttlTimer: null,
    ttlMs: DEFAULT_TTL_MS,
    createdAt: Date.now(),
    cols: 80,
    rows: 24,
  };

  console.log(`[${id}] PTY spawned: ${shellConfig.command} (pid: ${ptyProcess.pid})`);

  // PTY output -> log file + all connected clients
  ptyProcess.onData((data: string) => {
    try {
      logStream.write(data);
      for (const ws of session.clients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "output", data }));
        }
      }
    } catch {}
  });

  ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
    console.log(`[${id}] PTY exited with code ${exitCode}`);
    for (const ws of session.clients) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "exit", code: exitCode }));
        }
      } catch {}
    }
    destroySession(id);
  });

  sessions.set(id, session);

  // Save metadata
  const meta = readMetadata();
  meta[id] = {
    id,
    shell,
    title: sessionTitle,
    createdAt: new Date().toISOString(),
    ttlMs: DEFAULT_TTL_MS,
    lastActive: new Date().toISOString(),
  };
  writeMetadata(meta);

  return session;
}

function destroySession(id: string) {
  const s = sessions.get(id);
  if (!s) return;
  console.log(`[${id}] Destroying session`);

  if (s.ttlTimer) clearTimeout(s.ttlTimer);
  try { s.pty.kill(); } catch {}
  try { s.logStream.end(); } catch {}
  try { if (existsSync(s.logPath)) unlinkSync(s.logPath); } catch {}

  for (const ws of s.clients) {
    try { ws.close(); } catch {}
  }

  sessions.delete(id);

  const meta = readMetadata();
  delete meta[id];
  writeMetadata(meta);
}

function startTTL(session: Session) {
  if (session.ttlTimer) clearTimeout(session.ttlTimer);
  if (session.ttlMs === "unlimited") return;

  session.ttlTimer = setTimeout(() => {
    console.log(`[${session.id}] TTL expired, destroying session`);
    destroySession(session.id);
  }, session.ttlMs);
}

function cancelTTL(session: Session) {
  if (session.ttlTimer) {
    clearTimeout(session.ttlTimer);
    session.ttlTimer = null;
  }
}

export function setTTL(id: string, ttlMs: number | "unlimited") {
  const s = sessions.get(id);
  if (!s) return;
  s.ttlMs = ttlMs;
  updateMeta(id, { ttlMs });
  // If no clients connected, restart TTL with new value
  if (s.clients.size === 0) {
    cancelTTL(s);
    startTTL(s);
  }
}

// ---------- Auth ----------
function verifyAuth(req: any): boolean {
  const origin = req.headers.origin || "";
  const host = req.headers.host || "";
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1") ||
      origin.includes("localhost") || origin.includes("127.0.0.1")) {
    return true;
  }

  const cfHeader = req.headers["cf-access-authenticated-user-email"];
  if (cfHeader) return true;

  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const queryToken = url.searchParams.get("token");
  if (queryToken && JWT_SECRET) {
    try { verify(queryToken, JWT_SECRET); return true; } catch {}
  }

  const cookieHeader = req.headers.cookie;
  if (!cookieHeader || !JWT_SECRET) return false;
  try {
    const cookies = parseCookie(cookieHeader);
    const suffix = process.env.COOKIE_SUFFIX || "nosuffix";
    const token = cookies[`__Secure-pcdash-local-${suffix}`] || cookies["session"];
    if (!token) return false;
    verify(token, JWT_SECRET);
    return true;
  } catch { return false; }
}

// ---------- HTTP control endpoints ----------
import { createServer } from "http";

const httpServer = createServer((req, res) => {
  // Only allow localhost (dashboard talks to us over localhost)
  const host = req.headers.host || "";
  if (!host.startsWith("localhost") && !host.startsWith("127.0.0.1")) {
    res.writeHead(403); res.end(); return;
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url || "/", `http://${host}`);

  if (url.pathname === "/sessions" && req.method === "GET") {
    const list = Array.from(sessions.values()).map((s) => ({
      id: s.id,
      shell: s.shell,
      title: s.title,
      createdAt: new Date(s.createdAt).toISOString(),
      connected: s.clients.size,
      ttlMs: s.ttlMs,
      hasTTLRunning: !!s.ttlTimer,
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ sessions: list }));
    return;
  }

  // Create a new session via HTTP (returns the id; attach via WebSocket after)
  if (url.pathname === "/sessions" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      try {
        const { shell, title } = JSON.parse(body || "{}");
        const s = createSession(shell || "powershell", undefined, title);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: s.id, shell: s.shell, title: s.title, ttlMs: s.ttlMs }));
      } catch {
        res.writeHead(400); res.end();
      }
    });
    return;
  }

  if (url.pathname.startsWith("/sessions/") && req.method === "PATCH") {
    const id = url.pathname.split("/")[2];
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      try {
        const patch = JSON.parse(body);
        const s = sessions.get(id);
        if (!s) { res.writeHead(404); res.end(); return; }
        if (patch.ttlMs !== undefined) setTTL(id, patch.ttlMs);
        if (patch.title !== undefined) {
          s.title = String(patch.title);
          updateMeta(id, { title: s.title });
        }
        res.writeHead(200); res.end(JSON.stringify({ success: true }));
      } catch {
        res.writeHead(400); res.end();
      }
    });
    return;
  }

  if (url.pathname.startsWith("/sessions/") && req.method === "DELETE") {
    const id = url.pathname.split("/")[2];
    destroySession(id);
    res.writeHead(200); res.end(JSON.stringify({ success: true }));
    return;
  }

  res.writeHead(404); res.end();
});

// ---------- WebSocket server (shares HTTP server) ----------
const wss = new WebSocketServer({ server: httpServer });

httpServer.listen(PORT, () => {
  console.log(`Terminal server (WS + HTTP) listening on :${PORT}`);
});

wss.on("connection", (ws: WebSocket, req) => {
  if (!verifyAuth(req)) {
    ws.close(4001, "Unauthorized");
    return;
  }

  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const shellName = url.searchParams.get("shell") || "powershell";
  const sessionId = url.searchParams.get("sessionId") || undefined;

  // Reattach or create session
  let session: Session | undefined = sessionId ? sessions.get(sessionId) : undefined;

  if (session) {
    console.log(`[${session.id}] Client reattached (${session.clients.size + 1} total)`);
    cancelTTL(session);

    // Send existing buffered log to this client
    try {
      if (existsSync(session.logPath)) {
        const buffered = readFileSync(session.logPath, "utf-8");
        if (buffered.length > 0) {
          ws.send(JSON.stringify({ type: "output", data: buffered }));
        }
      }
    } catch {}
  } else {
    session = createSession(shellName, sessionId);
  }

  session.clients.add(ws);

  // Send session info so client knows the id
  try {
    ws.send(JSON.stringify({ type: "session", id: session.id, ttlMs: session.ttlMs }));
  } catch {}

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (!session) return;
      updateMeta(session.id, { lastActive: new Date().toISOString() });
      switch (msg.type) {
        case "input":
          session.pty.write(msg.data);
          break;
        case "resize":
          if (msg.cols && msg.rows) {
            session.pty.resize(msg.cols, msg.rows);
            session.cols = msg.cols;
            session.rows = msg.rows;
          }
          break;
        case "ttl":
          // { type: "ttl", ttlMs: number | "unlimited" }
          setTTL(session.id, msg.ttlMs);
          break;
      }
    } catch {}
  });

  ws.on("close", () => {
    if (!session) return;
    session.clients.delete(ws);
    console.log(`[${session.id}] Client disconnected (${session.clients.size} remaining)`);
    if (session.clients.size === 0) {
      startTTL(session);
    }
  });
});
