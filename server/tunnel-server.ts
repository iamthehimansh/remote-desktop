// Self-hosted serveo/ngrok-style tunnel server.
//
// A client runs:   ssh -R 80:localhost:3000 names.himansh.in
// (cloudflared ProxyCommand carries the SSH over the Cloudflare tunnel to :2222)
// We then interactively ask for a subdomain and expose their local port at
//   https://<name>.himansh.in
// via an HTTP multiplexer (:8090) that Cloudflare routes *.himansh.in to.
//
// Three localhost listeners:
//   :2222  ssh2 server  — auth, interactive naming, records the -R forward
//   :8090  http mux     — Host:<name>.himansh.in → forwardOut() to client's port
//   :8091  control API  — localhost-only list/kill for the dashboard
//
// Mirrors server/ws-server.ts conventions (manual env loading, data/ persistence).

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "fs";
import { resolve } from "path";
import http from "http";
import { generateKeyPairSync } from "crypto";
import { Server as SSHServer, type Connection } from "ssh2";

// ---------- env loading (same pattern as ws-server.ts) ----------
function loadEnvFile(path: string) {
  try {
    const envContent = readFileSync(path, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/\\(.)/g, "$1");
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}
if (process.platform === "linux") loadEnvFile(resolve(process.cwd(), ".env.linux"));
loadEnvFile(resolve(process.cwd(), ".env.local"));

// Imports that read env must come AFTER env is loaded.
import { verifyPassword } from "../src/lib/auth";
import { isValidSubdomain, isReservedSubdomain, suggestAlternatives, randomSubdomain } from "../src/lib/subdomain";
import { getForwards } from "../src/lib/port-store";

const SSH_PORT = Number(process.env.TUNNEL_SSH_PORT || 2222);
const HTTP_PORT = Number(process.env.TUNNEL_HTTP_PORT || 8090);
const CONTROL_PORT = Number(process.env.TUNNEL_CONTROL_PORT || 8091);
const BASE_DOMAIN = process.env.TUNNEL_BASE_DOMAIN || "himansh.in";

const DATA_DIR = resolve(process.cwd(), "data/tunnel");
const HOST_KEY_PATH = resolve(DATA_DIR, "host_key");
const AUTHORIZED_KEYS_PATH = resolve(DATA_DIR, "authorized_keys");

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// Keep the process alive through stray stream errors (ssh2 channels can throw on abrupt disconnects).
process.on("uncaughtException", (err: any) => {
  if (err?.code === "ECONNRESET" || err?.code === "EPIPE" || /Channel|closed/i.test(err?.message || "")) return;
  console.error("[tunnel] uncaught:", err);
});

// ---------- host key ----------
function loadOrCreateHostKey(): string {
  if (existsSync(HOST_KEY_PATH)) return readFileSync(HOST_KEY_PATH, "utf-8");
  // RSA in PKCS#1 PEM ("BEGIN RSA PRIVATE KEY") — a format ssh2 parses natively.
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 4096,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  writeFileSync(HOST_KEY_PATH, privateKey, { mode: 0o600 });
  try { chmodSync(HOST_KEY_PATH, 0o600); } catch {}
  console.log("[tunnel] generated new RSA host key");
  return privateKey;
}

// ---------- tunnel registry (ephemeral, in-memory) ----------
interface Tunnel {
  name: string;
  conn: Connection;
  bindAddr: string;
  bindPort: number;
  target: string;      // "localhost:3000" (informational; from the -R spec when known)
  client: string;      // remote client label
  createdAt: number;
  agent: http.Agent;   // opens forwardOut channels for the HTTP mux
}

const tunnels = new Map<string, Tunnel>();

function nameTaken(name: string): boolean {
  if (tunnels.has(name)) return true;
  if (isReservedSubdomain(name)) return true;
  try {
    if (getForwards().some((f) => f.subdomain === name)) return true;
  } catch {}
  return false;
}

// ---------- per-connection state ----------
interface ConnState {
  client: string;
  bindAddr: string;
  bindPort: number;
  hasForward: boolean;
  target: string;
  name?: string;
}
const connState = new WeakMap<Connection, ConnState>();

// An http.Agent whose sockets are ssh2 forwarded-tcpip channels to the client.
function makeChannelAgent(getConn: () => Connection, getBind: () => { addr: string; port: number }): http.Agent {
  const agent = new http.Agent({ keepAlive: false, maxSockets: Infinity });
  (agent as any).createConnection = (_opts: any, cb: (err: Error | null, sock?: any) => void) => {
    const conn = getConn();
    const { addr, port } = getBind();
    conn.forwardOut(addr || "127.0.0.1", port, "127.0.0.1", 0, (err: Error | undefined, channel: any) => {
      if (err) return cb(err);
      // ssh2 Channel is a Duplex but lacks some net.Socket methods http expects.
      channel.setNoDelay = channel.setNoDelay || (() => channel);
      channel.setKeepAlive = channel.setKeepAlive || (() => channel);
      channel.setTimeout = channel.setTimeout || (() => channel);
      channel.ref = channel.ref || (() => channel);
      channel.unref = channel.unref || (() => channel);
      cb(null, channel);
    });
  };
  return agent;
}

// ---------- SSH server ----------
const HOST_KEY = loadOrCreateHostKey();

function authorizedKeys(): string[] {
  try {
    return readFileSync(AUTHORIZED_KEYS_PATH, "utf-8")
      .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  } catch { return []; }
}

// Password auth: accept TUNNEL_PASSWORD (plain) if set, else fall back to the
// dashboard bcrypt hash. TUNNEL_PASSWORD lets the tunnel have its own password
// independent of the dashboard login.
async function checkPassword(pw: string): Promise<boolean> {
  const tp = process.env.TUNNEL_PASSWORD;
  if (tp && pw === tp) return true;
  try { return await verifyPassword(pw); } catch { return false; }
}

const sshServer = new SSHServer({ hostKeys: [HOST_KEY] }, (client: Connection) => {
  let label = "unknown";

  client.on("authentication", (ctx) => {
    if (ctx.method === "publickey") {
      // Accept only if the offered key is in authorized_keys (optional convenience).
      const keys = authorizedKeys();
      const offered = ctx.key.data.toString("base64");
      const ok = keys.some((k) => k.split(/\s+/).includes(offered) || k.includes(offered));
      if (ok) return ctx.accept();
      return ctx.reject(["password", "keyboard-interactive"]);
    }
    if (ctx.method === "password") {
      checkPassword(ctx.password).then((ok) => (ok ? ctx.accept() : ctx.reject()));
      return;
    }
    if (ctx.method === "keyboard-interactive") {
      ctx.prompt([{ prompt: "Password: ", echo: false }], (answers) => {
        checkPassword(answers?.[0] || "").then((ok) => (ok ? ctx.accept() : ctx.reject()));
      });
      return;
    }
    // Offer the methods we actually support.
    ctx.reject(["publickey", "password", "keyboard-interactive"]);
  });

  client.on("ready", () => {
    const info: any = (client as any)._sock?.remoteAddress;
    label = typeof info === "string" ? info : "client";
    connState.set(client, { client: label, bindAddr: "", bindPort: 0, hasForward: false, target: "" });
  });

  // `ssh -R <port>:host:hostport` → global "tcpip-forward" request.
  client.on("request", (accept, reject, reqName, reqInfo: any) => {
    if (reqName === "tcpip-forward") {
      const st = connState.get(client) || { client: label, bindAddr: "", bindPort: 0, hasForward: false, target: "" };
      st.bindAddr = reqInfo.bindAddr || "";
      st.bindPort = reqInfo.bindPort || 0;
      st.hasForward = true;
      connState.set(client, st);
      if (accept) accept(st.bindPort);
      // If the user already chose a name (prompt finished first), register now.
      if (st.name && !tunnels.has(st.name)) registerTunnel(client, st.name);
      return;
    }
    if (reqName === "cancel-tcpip-forward") { if (accept) accept(); return; }
    if (reject) reject();
  });

  client.on("session", (accept) => {
    const session = accept();
    session.on("pty", (a) => a && a());
    session.on("shell", (acc) => startRepl(client, acc()));
    session.on("exec", (acc) => {
      // Non-interactive: auto-assign a random name.
      const stream = acc();
      autoAssign(client, stream);
    });
  });

  client.on("close", () => cleanup(client));
  client.on("end", () => cleanup(client));
  client.on("error", () => {});
});

function cleanup(client: Connection) {
  const st = connState.get(client);
  if (st?.name) tunnels.delete(st.name);
  connState.delete(client);
}

function registerTunnel(client: Connection, name: string): Tunnel {
  const st = connState.get(client)!;
  st.name = name;
  const tunnel: Tunnel = {
    name,
    conn: client,
    bindAddr: st.bindAddr,
    bindPort: st.bindPort,
    target: st.target || `(remote :${st.bindPort})`,
    client: st.client,
    createdAt: Date.now(),
    agent: makeChannelAgent(() => client, () => ({ addr: st.bindAddr, port: st.bindPort })),
  };
  tunnels.set(name, tunnel);
  return tunnel;
}

// ---------- interactive naming REPL over the shell channel ----------
function startRepl(client: Connection, stream: any) {
  const w = (s: string) => { try { stream.write(s.replace(/\n/g, "\r\n")); } catch {} };
  w("\n  ┌─────────────────────────────────────────────┐\n");
  w("  │  names.himansh.in — instant public tunnels   │\n");
  w("  └─────────────────────────────────────────────┘\n\n");

  // Give the -R global request a moment to arrive, then check it exists.
  setTimeout(() => {
    const st = connState.get(client);
    if (!st?.hasForward) {
      w("  ✗ No remote forward found. Reconnect with:\n");
      w(`      ssh -R 80:localhost:3000 names.${""}${BASE_DOMAIN}\n\n`);
      try { stream.exit(1); stream.end(); } catch {}
      return;
    }
    promptName(client, stream, w);
  }, 400);
}

function promptName(client: Connection, stream: any, w: (s: string) => void) {
  w(`  Choose a subdomain (just <name> → https://<name>.${BASE_DOMAIN})\n`);
  w("  Press Enter for a random name.\n\n");
  readLine(stream, w, "  subdomain: ", (raw) => {
    let name = raw.trim().toLowerCase();
    if (!name) name = randomSubdomain();

    if (!isValidSubdomain(name)) {
      w("\n  ✗ Invalid. Use lowercase letters, numbers and hyphens.\n\n");
      return promptName(client, stream, w);
    }
    if (nameTaken(name)) {
      const sugg = suggestAlternatives(name, nameTaken);
      w(`\n  ✗ "${name}" is taken.`);
      if (sugg.length) w(`  Try: ${sugg.join("  ")}`);
      w("\n\n");
      return promptName(client, stream, w);
    }

    const tunnel = registerTunnel(client, name);
    const url = `https://${name}.${BASE_DOMAIN}`;
    w("\n  ✓ Tunnel live!\n\n");
    w(`      ${url}\n`);
    w(`      → forwarding to your local service\n\n`);
    w("  Keep this session open. Ctrl-C to stop.\n\n");
    void tunnel;

    // Keep listening so Ctrl-C / Ctrl-D / 'q' actually tears the tunnel down.
    const onKey = (d: Buffer) => {
      if (d.includes(0x03) || d.includes(0x04) || d.includes(0x71)) {
        w("\n  Closing tunnel — bye.\n");
        stream.removeListener("data", onKey);
        try { stream.exit(0); } catch {}
        try { stream.end(); } catch {}
        try { client.end(); } catch {}
      }
    };
    stream.on("data", onKey);
    stream.on("close", () => { try { client.end(); } catch {} });
  });
}

function autoAssign(client: Connection, stream: any) {
  const w = (s: string) => { try { stream.write(s); } catch {} };
  setTimeout(() => {
    const st = connState.get(client);
    if (!st?.hasForward) { w("No remote forward (-R) found.\n"); try { stream.exit(1); stream.end(); } catch {} return; }
    let name = randomSubdomain();
    while (nameTaken(name)) name = randomSubdomain();
    registerTunnel(client, name);
    w(`https://${name}.${BASE_DOMAIN}\n`);
  }, 400);
}

// Minimal raw-mode line reader (handles echo + backspace) for PTY shells.
function readLine(stream: any, w: (s: string) => void, prompt: string, cb: (line: string) => void) {
  w(prompt);
  let buf = "";
  const onData = (data: Buffer) => {
    for (const ch of data) {
      if (ch === 0x0d || ch === 0x0a) {
        stream.removeListener("data", onData);
        w("\n");
        return cb(buf);
      } else if (ch === 0x7f || ch === 0x08) {
        if (buf.length) { buf = buf.slice(0, -1); w("\b \b"); }
      } else if (ch === 0x03) {
        // Ctrl-C
        stream.removeListener("data", onData);
        try { stream.exit(0); stream.end(); } catch {}
        return;
      } else if (ch >= 0x20 && ch < 0x7f) {
        buf += String.fromCharCode(ch);
        w(String.fromCharCode(ch));
      }
    }
  };
  stream.on("data", onData);
}

sshServer.listen(SSH_PORT, "127.0.0.1", () => {
  console.log(`[tunnel] ssh server on 127.0.0.1:${SSH_PORT}`);
});

// ---------- HTTP multiplexer ----------
function tunnelForHost(host?: string): Tunnel | undefined {
  if (!host) return undefined;
  const h = host.split(":")[0].toLowerCase();
  const suffix = `.${BASE_DOMAIN}`;
  if (!h.endsWith(suffix)) return undefined;
  const name = h.slice(0, -suffix.length);
  if (!name || name.includes(".")) return undefined; // only first-level <name>.himansh.in
  return tunnels.get(name);
}

const httpProxy = require("http-proxy").createProxyServer({ ws: true, xfwd: true });
httpProxy.on("error", (_err: Error, _req: any, res: any) => {
  try {
    if (res && res.writeHead && !res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Tunnel origin error\n");
    } else if (res && res.end) { res.end(); }
  } catch {}
});

const mux = http.createServer((req, res) => {
  const tunnel = tunnelForHost(req.headers.host);
  if (!tunnel) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("No active tunnel for this host.\n");
    return;
  }
  httpProxy.web(req, res, {
    target: { host: "tunnel.local", port: 80 },
    agent: tunnel.agent,
  });
});

mux.on("upgrade", (req, socket, head) => {
  const tunnel = tunnelForHost(req.headers.host);
  if (!tunnel) { socket.destroy(); return; }
  httpProxy.ws(req, socket, head, {
    target: { host: "tunnel.local", port: 80 },
    agent: tunnel.agent,
  });
});

mux.listen(HTTP_PORT, "127.0.0.1", () => {
  console.log(`[tunnel] http mux on 127.0.0.1:${HTTP_PORT}`);
});

// ---------- control API (localhost only, for the dashboard) ----------
const control = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  const url = req.url || "/";
  if (req.method === "GET" && url === "/tunnels") {
    const list = [...tunnels.values()].map((t) => ({
      name: t.name,
      hostname: `${t.name}.${BASE_DOMAIN}`,
      url: `https://${t.name}.${BASE_DOMAIN}`,
      target: t.target,
      client: t.client,
      createdAt: new Date(t.createdAt).toISOString(),
    }));
    res.writeHead(200);
    res.end(JSON.stringify({ tunnels: list }));
    return;
  }
  if (req.method === "DELETE" && url.startsWith("/tunnels/")) {
    const name = decodeURIComponent(url.slice("/tunnels/".length));
    const t = tunnels.get(name);
    if (!t) { res.writeHead(404); res.end(JSON.stringify({ error: "not found" })); return; }
    try { t.conn.end(); } catch {}
    tunnels.delete(name);
    res.writeHead(200);
    res.end(JSON.stringify({ success: true }));
    return;
  }
  res.writeHead(404);
  res.end(JSON.stringify({ error: "not found" }));
});

control.listen(CONTROL_PORT, "127.0.0.1", () => {
  console.log(`[tunnel] control api on 127.0.0.1:${CONTROL_PORT}`);
});
