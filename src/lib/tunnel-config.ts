import { readFileSync, writeFileSync } from "fs";
import { parse, stringify } from "yaml";

const API_BASE = "https://api.cloudflare.com/client/v4";

interface IngressRule {
  hostname?: string;
  path?: string;
  service: string;
  originRequest?: Record<string, unknown>;
}

interface TunnelConfig {
  tunnel: string;
  "credentials-file": string;
  ingress: IngressRule[];
}

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

function getConfigPath(): string {
  if (process.env.CLOUDFLARED_CONFIG_PATH) return process.env.CLOUDFLARED_CONFIG_PATH;
  if (process.platform === "win32") return "C:\\Users\\pc\\.cloudflared\\config.yml";
  return `${process.env.HOME || "/root"}/.cloudflared/config.yml`;
}

export function readConfig(): TunnelConfig {
  const content = readFileSync(getConfigPath(), "utf-8");
  return parse(content) as TunnelConfig;
}

// Read current remote config from Cloudflare API
async function getRemoteConfig(): Promise<IngressRule[]> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const tunnelId = process.env.TUNNEL_ID;

  const res = await fetch(
    `${API_BASE}/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
    { headers: getHeaders() }
  );

  const data = await res.json();
  if (!data.success) {
    throw new Error(data.errors?.[0]?.message || "Failed to get remote config");
  }

  return data.result?.config?.ingress || [];
}

// Push config to Cloudflare API — cloudflared picks it up automatically
async function putRemoteConfig(ingress: IngressRule[]): Promise<void> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const tunnelId = process.env.TUNNEL_ID;

  const res = await fetch(
    `${API_BASE}/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
    {
      method: "PUT",
      headers: getHeaders(),
      body: JSON.stringify({
        config: { ingress },
      }),
    }
  );

  const data = await res.json();
  if (!data.success) {
    console.error("Tunnel API error:", JSON.stringify(data.errors));
    throw new Error(data.errors?.[0]?.message || "Failed to update tunnel config");
  }
}

// A "fallback" rule is a wildcard (e.g. `*.himansh.in`, used by the SSH tunnel
// router) or the bare catch-all (no hostname -> http_status:404). Specific
// hostname rules (static services + port-forwards) must be inserted BEFORE these
// so cloudflared (first-match-wins) routes them directly instead of letting the
// wildcard swallow them.
function isFallbackRule(r: IngressRule): boolean {
  return !r.hostname || r.hostname.startsWith("*");
}

// Insert/replace a specific-hostname rule just before the first fallback rule.
function upsertSpecificRule(ingress: IngressRule[], rule: IngressRule): IngressRule[] {
  const cleaned = ingress.filter((r) => r.hostname !== rule.hostname);
  const idx = cleaned.findIndex(isFallbackRule);
  const insertAt = idx === -1 ? cleaned.length : idx;
  cleaned.splice(insertAt, 0, rule);
  return cleaned;
}

export async function addIngressRule(hostname: string, localPort: number, protocol: string): Promise<void> {
  const service = protocol === "ws"
    ? `ws://localhost:${localPort}`
    : `http://localhost:${localPort}`;

  const ingress = await getRemoteConfig();
  await putRemoteConfig(upsertSpecificRule(ingress, { hostname, service }));

  // Also save locally as backup
  try {
    const localConfig = readConfig();
    localConfig.ingress = upsertSpecificRule(localConfig.ingress, { hostname, service });
    writeFileSync(getConfigPath(), stringify(localConfig, { lineWidth: 0 }));
  } catch {}
}

export async function removeIngressRule(hostname: string): Promise<void> {
  const ingress = await getRemoteConfig();
  const filtered = ingress.filter((rule: any) => rule.hostname !== hostname);

  await putRemoteConfig(filtered);

  // Also update local backup
  try {
    const localConfig = readConfig();
    localConfig.ingress = localConfig.ingress.filter((rule) => rule.hostname !== hostname);
    writeFileSync(getConfigPath(), stringify(localConfig, { lineWidth: 0 }));
  } catch {}
}

// No restart needed — remote config is picked up automatically
export async function reloadTunnel(): Promise<void> {
  // No-op! Cloudflare API config is applied automatically by cloudflared.
  console.log("Using remote config — no tunnel restart needed");
}
