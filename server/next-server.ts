// Custom Next.js server that proxies Guacamole WebSocket upgrades after
// verifying the dashboard session JWT. HTTP paths still pass through Next.js
// (middleware + rewrites).
import { createServer, IncomingMessage, ServerResponse } from "http";
import { parse as parseUrl } from "url";
import { parse as parseCookie } from "cookie";
import { verify } from "jsonwebtoken";
import next from "next";
import { readFileSync } from "fs";
import { resolve } from "path";
import httpProxy from "http-proxy";

// Load .env.local manually
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
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT || 3005);
const JWT_SECRET = process.env.JWT_SECRET || "";
const GUAC_TARGET = "http://localhost:8080";

const app = next({ dev, port });
const handle = app.getRequestHandler();

const proxy = httpProxy.createProxyServer({
  target: GUAC_TARGET,
  ws: true,
  changeOrigin: true,
});

proxy.on("error", (err, _req, res) => {
  console.error("Guacamole proxy error:", err.message);
  if (res && "writeHead" in res) {
    try { (res as ServerResponse).writeHead(502); (res as ServerResponse).end("Guacamole unreachable"); } catch {}
  }
});

function verifySession(req: IncomingMessage): boolean {
  const queryToken = (() => {
    try {
      const u = parseUrl(req.url || "", true);
      const t = u.query?.token;
      return typeof t === "string" ? t : null;
    } catch { return null; }
  })();

  const cookieHeader = req.headers.cookie || "";
  const cookies = parseCookie(cookieHeader);
  const token = cookies["session"] || queryToken;

  if (!token || !JWT_SECRET) return false;
  try {
    verify(token, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const url = parseUrl(req.url || "", true);

    // Auth-protect any /guacamole/* HTTP request (belt-and-braces, middleware also does this)
    if (url.pathname && url.pathname.startsWith("/guacamole")) {
      if (!verifySession(req)) {
        res.writeHead(302, { Location: "/login" });
        res.end();
        return;
      }
      // Proxy directly to Guacamole — bypass Next.js rewrite overhead
      proxy.web(req, res);
      return;
    }

    handle(req, res, url);
  });

  // Handle WebSocket upgrades (Guacamole tunnel uses wss://.../guacamole/websocket-tunnel)
  server.on("upgrade", (req, socket, head) => {
    const url = parseUrl(req.url || "", true);

    if (url.pathname && url.pathname.startsWith("/guacamole")) {
      if (!verifySession(req)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      proxy.ws(req, socket as any, head);
      return;
    }

    // Let Next.js handle HMR WebSockets in dev
    // @ts-ignore
    if (app.getUpgradeHandler) {
      // @ts-ignore
      app.getUpgradeHandler()(req, socket, head);
    }
  });

  server.listen(port, () => {
    console.log(`> Dashboard ready on http://localhost:${port} (with Guacamole proxy)`);
  });
});
