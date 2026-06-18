// Protect the Linux remote-desktop subdomains (desk/screen) behind the same
// pcdash-gate Cloudflare Worker OIDC login used by the Apps section.
// Mirrors src/app/api/apps/update/route.ts (auth ON): register an OAuth client,
// add the Worker route for the hostname, then sync all client secrets to the Worker.
//
// Usage: node --import tsx scripts/linux/protect-subdomains.ts [desk.himansh.in,screen.himansh.in]
import { readFileSync } from "fs";
import { resolve } from "path";
import { addClient, listClients } from "../../src/lib/oauth-clients";
import { addWorkerRoute, syncWorkerSecrets } from "../../src/lib/cf-worker";

// Load env (.env.linux first on Linux so it wins, then .env.local for secrets).
function loadEnv(p: string) {
  try {
    for (const line of readFileSync(p, "utf-8").split("\n")) {
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
if (process.platform === "linux") loadEnv(resolve(process.cwd(), ".env.linux"));
loadEnv(resolve(process.cwd(), ".env.local"));

const HOSTS = (process.argv[2] || "desk.himansh.in,screen.himansh.in")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

(async () => {
  for (const host of HOSTS) {
    const clientId = host.split(".")[0]; // "desk" / "screen" — matches the Worker's getAppId()
    const redirectUri = `https://${host}/__pcdash/callback`;
    addClient(clientId, [redirectUri]);
    try {
      await addWorkerRoute(host);
      console.log(`  protected ${host} (OAuth client "${clientId}" + Worker route)`);
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (/already exists|duplicate|exists/i.test(msg)) {
        console.log(`  ${host}: Worker route already exists (client ensured)`);
      } else {
        console.log(`  WARN ${host}: ${msg}`);
      }
    }
  }
  // Push every client's secret into the Worker's OAUTH_CLIENT_SECRETS.
  const secrets: Record<string, string> = {};
  for (const c of listClients()) secrets[c.clientId] = c.clientSecret;
  await syncWorkerSecrets(secrets);
  console.log("  Worker secrets synced.");
})().catch((e) => {
  console.error("protect-subdomains failed:", e?.message || e);
  process.exit(1);
});
