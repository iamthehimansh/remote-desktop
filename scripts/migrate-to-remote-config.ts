// One-time script: push local cloudflared config to Cloudflare API
// After this, cloudflared will use remote-managed config

import { readFileSync } from "fs";
import { parse } from "yaml";

const envPath = "H:/remote-desktop/.env.local";
const configPath = "C:/Users/pc/.cloudflared/config.yml";

// Load env
const envContent = readFileSync(envPath, "utf-8");
const env: Record<string, string> = {};
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim().replace(/\\(.)/g, "$1");
}

const API_BASE = "https://api.cloudflare.com/client/v4";
const accountId = env.CLOUDFLARE_ACCOUNT_ID;
const tunnelId = env.TUNNEL_ID;
const apiToken = env.CLOUDFLARE_API_TOKEN;

// Read local config
const localConfig = parse(readFileSync(configPath, "utf-8"));
console.log("Local ingress rules:");
for (const rule of localConfig.ingress) {
  console.log(`  ${rule.hostname || "(catch-all)"} ${rule.path || ""} -> ${rule.service}`);
}

// Push to API
async function migrate() {
  const res = await fetch(
    `${API_BASE}/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        config: {
          ingress: localConfig.ingress,
        },
      }),
    }
  );

  const data = await res.json();
  if (data.success) {
    console.log("\nRemote config updated successfully!");
    console.log("cloudflared will now use remote-managed config.");
  } else {
    console.error("\nFailed:", JSON.stringify(data.errors, null, 2));
  }
}

migrate();
