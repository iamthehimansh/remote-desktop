import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";

export interface PortForward {
  id: string;
  localPort: number;
  subdomain: string;
  hostname: string;
  protocol: string;
  dnsRecordId: string;
  createdAt: string;
}

interface PortData {
  forwards: PortForward[];
}

const DATA_PATH = resolve(process.cwd(), "data/port-forwards.json");

function ensureDir() {
  const dir = dirname(DATA_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function readPortData(): PortData {
  ensureDir();
  if (!existsSync(DATA_PATH)) {
    writeFileSync(DATA_PATH, JSON.stringify({ forwards: [] }, null, 2));
    return { forwards: [] };
  }
  return JSON.parse(readFileSync(DATA_PATH, "utf-8"));
}

export function writePortData(data: PortData): void {
  ensureDir();
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

export function addForward(forward: PortForward): void {
  const data = readPortData();
  data.forwards.push(forward);
  writePortData(data);
}

export function removeForward(id: string): PortForward | undefined {
  const data = readPortData();
  const idx = data.forwards.findIndex((f) => f.id === id);
  if (idx === -1) return undefined;
  const [removed] = data.forwards.splice(idx, 1);
  writePortData(data);
  return removed;
}

export function getForwards(): PortForward[] {
  return readPortData().forwards;
}
