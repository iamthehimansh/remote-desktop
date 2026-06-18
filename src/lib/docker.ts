import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const IS_LINUX = process.platform === "linux";

// --- Windows path: Apache Guacamole in Docker ---
const COMPOSE_FILE = "docker-compose.guacamole.yml";
const PROJECT_DIR = process.env.GUAC_COMPOSE_DIR || process.cwd();

// --- Linux path: TigerVNC virtual desktop + noVNC, run as user systemd services.
// The actual desktop view is served at the `desk` Cloudflare subdomain (noVNC),
// not embedded in the dashboard. start/stop/status here just manage the services.
const VNC_SERVICES = (process.env.VNC_SERVICES || "pcdash-vnc.service pcdash-novnc.service")
  .split(/\s+/)
  .filter(Boolean);
const NOVNC_PORT = Number(process.env.NOVNC_PORT || 6080);

async function systemctlUser(action: "start" | "stop"): Promise<void> {
  await execAsync(`systemctl --user ${action} ${VNC_SERVICES.join(" ")}`);
}

export async function startGuacamole(): Promise<void> {
  if (IS_LINUX) {
    await systemctlUser("start");
    return;
  }
  await execAsync(`docker compose -f ${COMPOSE_FILE} up -d`, { cwd: PROJECT_DIR });
}

export async function stopGuacamole(): Promise<void> {
  if (IS_LINUX) {
    await systemctlUser("stop");
    return;
  }
  await execAsync(`docker compose -f ${COMPOSE_FILE} down`, { cwd: PROJECT_DIR });
}

export async function getGuacamoleStatus(): Promise<boolean> {
  if (IS_LINUX) {
    // Any HTTP response means websockify/noVNC is listening => remote desktop is up.
    // (noVNC's root may 404; we only care that the port answers.)
    try {
      await fetch(`http://localhost:${NOVNC_PORT}/vnc.html`);
      return true;
    } catch {
      return false;
    }
  }
  try {
    const { stdout } = await execAsync(
      'docker ps --filter "name=pc-dash-guacamole" --format "{{.Status}}"'
    );
    return stdout.trim().toLowerCase().startsWith("up");
  } catch {
    return false;
  }
}

export async function waitForGuacamole(timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();

  if (IS_LINUX) {
    while (Date.now() - start < timeoutMs) {
      if (await getGuacamoleStatus()) return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }

  const guacUrl = `http://localhost:${process.env.GUAC_PORT || 8080}/guacamole/`;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(guacUrl);
      if (res.ok || res.status === 302) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
