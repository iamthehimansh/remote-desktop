// One-time (idempotent) Cloudflare setup for the SSH tunnel service.
//
//   names.himansh.in  → ssh://localhost:2222   (the ssh2 tunnel server)
//   *.himansh.in      → http://localhost:8090  (the HTTP multiplexer)
//
// Ordering in the tunnel ingress matters (first match wins):
//   [ ...specific hostnames..., names.himansh.in, *.himansh.in, catch-all 404 ]
// so existing named services keep routing and the wildcard only catches the rest.
//
// Run:  npm run setup-tunnel-ingress   (or: node --import tsx scripts/setup-tunnel-ingress.ts)

import { readFileSync } from "fs";
import { resolve } from "path";

function loadEnvFile(path: string) {
  try {
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/\\(.)/g, "$1");
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {}
}
if (process.platform === "linux") loadEnvFile(resolve(process.cwd(), ".env.linux"));
loadEnvFile(resolve(process.cwd(), ".env.local"));

const API = "https://api.cloudflare.com/client/v4";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN!;
const ZONE = process.env.CLOUDFLARE_ZONE_ID!;
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID!;
const TUNNEL = process.env.TUNNEL_ID!;
const BASE = process.env.TUNNEL_BASE_DOMAIN || "himansh.in";

const SSH_PORT = Number(process.env.TUNNEL_SSH_PORT || 2222);
const HTTP_PORT = Number(process.env.TUNNEL_HTTP_PORT || 8090);

const NAMES_HOST = `names.${BASE}`;
const WILDCARD_HOST = `*.${BASE}`;
const NAMES_SERVICE = `ssh://localhost:${SSH_PORT}`;
const WILDCARD_SERVICE = `http://localhost:${HTTP_PORT}`;

const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!data.success) throw new Error(`${method} ${path}: ${JSON.stringify(data.errors)}`);
  return data.result;
}

async function ensureDNS(name: string) {
  const existing = await api("GET", `/zones/${ZONE}/dns_records?name=${encodeURIComponent(name)}`);
  if (existing.length > 0) {
    console.log(`DNS ok: ${name} -> ${existing[0].content} (proxied=${existing[0].proxied})`);
    return;
  }
  await api("POST", `/zones/${ZONE}/dns_records`, {
    type: "CNAME",
    name,
    content: `${TUNNEL}.cfargotunnel.com`,
    proxied: true,
    comment: "SSH tunnel service (setup-tunnel-ingress)",
  });
  console.log(`DNS created: ${name} -> ${TUNNEL}.cfargotunnel.com (proxied)`);
}

async function main() {
  for (const v of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID", "CLOUDFLARE_ACCOUNT_ID", "TUNNEL_ID"]) {
    if (!process.env[v]) throw new Error(`Missing env: ${v}`);
  }

  await ensureDNS(NAMES_HOST);
  await ensureDNS(WILDCARD_HOST);

  // Fetch current ingress.
  const cfg = await api("GET", `/accounts/${ACCOUNT}/cfd_tunnel/${TUNNEL}/configurations`);
  let ingress: Array<{ hostname?: string; service: string; path?: string; originRequest?: unknown }> =
    cfg?.config?.ingress || [];

  // Drop any prior copies of our two rules and the catch-all.
  const catchAll = ingress.find((r) => !r.hostname) || { service: "http_status:404" };
  ingress = ingress.filter(
    (r) => r.hostname && r.hostname !== NAMES_HOST && r.hostname !== WILDCARD_HOST
  );

  // Append in the required order: specific names → wildcard → catch-all.
  ingress.push({ hostname: NAMES_HOST, service: NAMES_SERVICE });
  ingress.push({ hostname: WILDCARD_HOST, service: WILDCARD_SERVICE });
  ingress.push(catchAll);

  await api("PUT", `/accounts/${ACCOUNT}/cfd_tunnel/${TUNNEL}/configurations`, { config: { ingress } });

  console.log("\nIngress updated:");
  for (const r of ingress) console.log(`  ${(r.hostname || "(catch-all)").padEnd(28)} -> ${r.service}`);
  console.log("\nDone.");
}

main().catch((e) => {
  console.error("setup-tunnel-ingress failed:", e.message || e);
  process.exit(1);
});
