import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const COMPOSE_FILE = "docker-compose.guacamole.yml";
const PROJECT_DIR = process.env.GUAC_COMPOSE_DIR || process.cwd();

export async function startGuacamole(): Promise<void> {
  await execAsync(`docker compose -f ${COMPOSE_FILE} up -d`, { cwd: PROJECT_DIR });
}

export async function stopGuacamole(): Promise<void> {
  await execAsync(`docker compose -f ${COMPOSE_FILE} down`, { cwd: PROJECT_DIR });
}

export async function getGuacamoleStatus(): Promise<boolean> {
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
