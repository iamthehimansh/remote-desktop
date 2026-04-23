// Deploy the Worker to Cloudflare using direct API calls (no wrangler CLI needed).
// Uploads the bundled worker code + sets secrets (JWT_SECRET, OAUTH_CLIENT_SECRETS)
// and ensures the KV namespace exists.
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { build } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PROJECT_ROOT = resolve(ROOT, "..");

// Load env from project .env.local
const env: Record<string, string> = {};
for (const line of readFileSync(resolve(PROJECT_ROOT, ".env.local"), "utf-8").split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("="); if (eq === -1) continue;
  env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/\\(.)/g, "$1");
}

const ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = env.CLOUDFLARE_API_TOKEN;
const JWT_SECRET = env.JWT_SECRET;
const COOKIE_SUFFIX = env.COOKIE_SUFFIX;
const WORKER_NAME = "pcdash-gate";

if (!ACCOUNT_ID || !API_TOKEN || !JWT_SECRET || !COOKIE_SUFFIX) {
  console.error("Missing required env vars");
  process.exit(1);
}

const API = "https://api.cloudflare.com/client/v4";
const authHeader = { Authorization: `Bearer ${API_TOKEN}` };

async function cf(method: string, path: string, body?: any, extraHeaders: Record<string, string> = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { ...authHeader, "Content-Type": "application/json", ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!(data as any).success) {
    console.error(`CF ${method} ${path} failed:`, JSON.stringify((data as any).errors));
    throw new Error("cf api failure");
  }
  return (data as any).result;
}

// 1. Ensure KV namespace
async function ensureKv(): Promise<string> {
  const list = await cf("GET", `/accounts/${ACCOUNT_ID}/storage/kv/namespaces?per_page=100`) as Array<{ id: string; title: string }>;
  const existing = list.find((n) => n.title === "PCDASH_RL");
  if (existing) return existing.id;
  const created = await cf("POST", `/accounts/${ACCOUNT_ID}/storage/kv/namespaces`, { title: "PCDASH_RL" }) as { id: string };
  return created.id;
}

// 2. Bundle worker code
async function bundle(): Promise<string> {
  const res = await build({
    entryPoints: [resolve(ROOT, "src/index.ts")],
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "neutral",
    write: false,
    minify: false,
  });
  return res.outputFiles[0].text;
}

// 3. Upload worker script (multipart metadata + module)
async function uploadWorker(code: string, kvId: string) {
  const metadata = {
    main_module: "index.js",
    bindings: [
      { type: "kv_namespace", name: "PCDASH_RL", namespace_id: kvId },
      { type: "plain_text", name: "DASHBOARD_URL", text: "https://pc.himansh.in" },
      { type: "plain_text", name: "COOKIE_SUFFIX", text: COOKIE_SUFFIX },
    ],
    compatibility_date: "2026-01-01",
  };

  const boundary = "----wrangler" + Math.random().toString(36).slice(2);
  const parts: string[] = [];
  parts.push(`--${boundary}\r\n`);
  parts.push(`Content-Disposition: form-data; name="metadata"; filename="metadata.json"\r\n`);
  parts.push(`Content-Type: application/json\r\n\r\n`);
  parts.push(JSON.stringify(metadata) + "\r\n");
  parts.push(`--${boundary}\r\n`);
  parts.push(`Content-Disposition: form-data; name="index.js"; filename="index.js"\r\n`);
  parts.push(`Content-Type: application/javascript+module\r\n\r\n`);
  parts.push(code + "\r\n");
  parts.push(`--${boundary}--\r\n`);

  const res = await fetch(`${API}/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}`, {
    method: "PUT",
    headers: { ...authHeader, "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: parts.join(""),
  });
  const data = await res.json();
  if (!(data as any).success) {
    console.error("Worker upload failed:", JSON.stringify((data as any).errors));
    throw new Error("worker upload failure");
  }
  console.log("Worker uploaded:", WORKER_NAME);
}

// 4. Set secrets (JWT_SECRET + OAUTH_CLIENT_SECRETS)
async function setSecret(name: string, value: string) {
  await cf("PUT", `/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/secrets`, {
    name, text: value, type: "secret_text",
  });
  console.log(`Secret set: ${name}`);
}

async function main() {
  console.log("Ensuring KV namespace…");
  const kvId = await ensureKv();
  console.log("KV id:", kvId);

  console.log("Bundling worker…");
  const code = await bundle();
  console.log(`Bundled ${code.length} bytes`);

  console.log("Uploading worker…");
  await uploadWorker(code, kvId);

  console.log("Setting secrets…");
  await setSecret("JWT_SECRET", JWT_SECRET!);
  await setSecret("OAUTH_CLIENT_SECRETS", "{}"); // empty until apps are toggled on

  console.log("\nDone. Worker is deployed. Enable auth on an app to add a route.");
}

main().catch((err) => { console.error(err); process.exit(1); });
