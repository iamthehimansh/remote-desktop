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
  return process.env.CLOUDFLARED_CONFIG_PATH || "C:\\Users\\pc\\.cloudflared\\config.yml";
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

export async function addIngressRule(hostname: string, localPort: number, protocol: string): Promise<void> {
  const service = protocol === "ws"
    ? `ws://localhost:${localPort}`
    : `http://localhost:${localPort}`;

  const ingress = await getRemoteConfig();

  // Insert before the catch-all rule (last entry)
  const catchAll = ingress.pop()!;
  ingress.push({ hostname, service });
  ingress.push(catchAll);

  await putRemoteConfig(ingress);

  // Also save locally as backup
  try {
    const localConfig = readConfig();
    const localCatchAll = localConfig.ingress.pop()!;
    localConfig.ingress.push({ hostname, service });
    localConfig.ingress.push(localCatchAll);
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
