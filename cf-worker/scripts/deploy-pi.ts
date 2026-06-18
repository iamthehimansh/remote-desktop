// Deploy the SAME cf-worker source as a second Worker: "pidash-gate"
// for pi-dash. Distinct KV (PIDASH_RL), cookie prefix, DASHBOARD_URL, and
// JWT_SECRET (picked up from pi-dash/.env).
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { build } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PROJECT_ROOT = resolve(ROOT, "..");
const PI_ROOT = resolve(PROJECT_ROOT, "pi-dash");

// Load pc-dash env (for CF account/token/zone)
const env: Record<string, string> = {};
for (const line of readFileSync(resolve(PROJECT_ROOT, ".env.local"), "utf-8").split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("="); if (eq === -1) continue;
  env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/\\(.)/g, "$1");
}

// Load pi-dash env (for pi-specific JWT_SECRET, COOKIE_SUFFIX)
const piEnv: Record<string, string> = {};
for (const line of readFileSync(resolve(PI_ROOT, ".env"), "utf-8").split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("="); if (eq === -1) continue;
  piEnv[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/\\(.)/g, "$1");
}

const ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = env.CLOUDFLARE_API_TOKEN;
const JWT_SECRET = piEnv.JWT_SECRET;
const COOKIE_SUFFIX = piEnv.COOKIE_SUFFIX;
const WORKER_NAME = "pidash-gate";
const DASHBOARD_URL = "https://pi.himansh.in";
const COOKIE_PREFIX = "__Secure-pidash-app-";
const KV_TITLE = "PIDASH_RL";

if (!ACCOUNT_ID || !API_TOKEN || !JWT_SECRET || !COOKIE_SUFFIX) {
  console.error("Missing required env vars (need CF creds in .env.local AND pi-dash/.env with JWT_SECRET + COOKIE_SUFFIX)");
  process.exit(1);
}

const API = "https://api.cloudflare.com/client/v4";
const authHeader = { Authorization: `Bearer ${API_TOKEN}` };

async function cf(method: string, path: string, body?: any) {
  const res = await fetch(API + path, {
    method,
    headers: { ...authHeader, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!(data as any).success) {
    console.error(`CF ${method} ${path} failed:`, JSON.stringify((data as any).errors));
    throw new Error("cf api failure");
  }
  return (data as any).result;
}

async function ensureKv(): Promise<string> {
  const list = await cf("GET", `/accounts/${ACCOUNT_ID}/storage/kv/namespaces?per_page=100`) as Array<{ id: string; title: string }>;
  const existing = list.find((n) => n.title === KV_TITLE);
  if (existing) return existing.id;
  const created = await cf("POST", `/accounts/${ACCOUNT_ID}/storage/kv/namespaces`, { title: KV_TITLE }) as { id: string };
  return created.id;
}

async function bundle(): Promise<string> {
  const res = await build({
    entryPoints: [resolve(ROOT, "src/index.ts")],
    bundle: true, format: "esm", target: "es2022",
    platform: "neutral", write: false, minify: false,
  });
  return res.outputFiles[0].text;
}

async function uploadWorker(code: string, kvId: string) {
  const metadata = {
    main_module: "index.js",
    bindings: [
      { type: "kv_namespace", name: "PCDASH_RL", namespace_id: kvId }, // binding name kept; KV is separate
      { type: "plain_text", name: "DASHBOARD_URL", text: DASHBOARD_URL },
      { type: "plain_text", name: "COOKIE_SUFFIX", text: COOKIE_SUFFIX },
      { type: "plain_text", name: "COOKIE_PREFIX", text: COOKIE_PREFIX },
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

async function setSecret(name: string, value: string) {
  await cf("PUT", `/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/secrets`, {
    name, text: value, type: "secret_text",
  });
  console.log(`Secret set: ${name}`);
}

async function main() {
  console.log("Ensuring KV namespace:", KV_TITLE);
  const kvId = await ensureKv();
  console.log("KV id:", kvId);

  console.log("Bundling worker…");
  const code = await bundle();
  console.log(`Bundled ${code.length} bytes`);

  console.log("Uploading worker…");
  await uploadWorker(code, kvId);

  console.log("Setting secrets…");
  await setSecret("JWT_SECRET", JWT_SECRET!);

  // Preserve existing pi-dash client secrets
  let clientSecrets = "{}";
  try {
    const raw = readFileSync(resolve(PI_ROOT, "data/oauth-clients.json"), "utf-8");
    const clients = JSON.parse(raw) as Record<string, { clientSecret: string }>;
    const map: Record<string, string> = {};
    for (const [id, c] of Object.entries(clients)) map[id] = c.clientSecret;
    clientSecrets = JSON.stringify(map);
    console.log(`Synced ${Object.keys(map).length} pi-dash client secret(s)`);
  } catch {
    console.log("No pi-dash oauth-clients.json yet; setting empty secrets");
  }
  await setSecret("OAUTH_CLIENT_SECRETS", clientSecrets);

  console.log("\nDone. pidash-gate deployed with DASHBOARD_URL=" + DASHBOARD_URL);
}

main().catch((err) => { console.error(err); process.exit(1); });
