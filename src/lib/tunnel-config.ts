import { readFileSync, writeFileSync } from "fs";
import { parse, stringify } from "yaml";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

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

function getConfigPath(): string {
  return process.env.CLOUDFLARED_CONFIG_PATH || "C:\\Users\\pc\\.cloudflared\\config.yml";
}

function getServiceConfigPath(): string {
  return (
    process.env.CLOUDFLARED_SERVICE_CONFIG_PATH ||
    "C:\\Windows\\System32\\config\\systemprofile\\.cloudflared\\config.yml"
  );
}

export function readConfig(): TunnelConfig {
  const content = readFileSync(getConfigPath(), "utf-8");
  return parse(content) as TunnelConfig;
}

export function addIngressRule(hostname: string, localPort: number, protocol: string): void {
  const config = readConfig();
  const service = protocol === "ws"
    ? `ws://localhost:${localPort}`
    : `http://localhost:${localPort}`;

  // Insert before the catch-all rule (last entry)
  const catchAll = config.ingress.pop()!;
  config.ingress.push({ hostname, service });
  config.ingress.push(catchAll);

  saveConfig(config);
}

export function removeIngressRule(hostname: string): void {
  const config = readConfig();
  config.ingress = config.ingress.filter((rule) => rule.hostname !== hostname);
  saveConfig(config);
}

function saveConfig(config: TunnelConfig): void {
  const content = stringify(config, { lineWidth: 0 });

  // Write to user config
  writeFileSync(getConfigPath(), content);

  // Write to SYSTEM service config (may need admin rights)
  try {
    const serviceContent = content.replace(
      /C:\\Users\\pc/g,
      "C:\\Windows\\System32\\config\\systemprofile"
    );
    writeFileSync(getServiceConfigPath(), serviceContent);
  } catch (err) {
    console.warn("Could not write service config (needs admin):", err);
  }
}

export async function reloadTunnel(): Promise<void> {
  try {
    await execAsync("net stop cloudflared && net start cloudflared");
  } catch (err) {
    console.warn("Could not restart cloudflared service:", err);
    throw new Error("Failed to restart cloudflared. May need admin privileges.");
  }
}
