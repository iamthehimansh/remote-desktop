// Short-lived, single-use authorization codes.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { randomBytes } from "crypto";

interface Code {
  code: string;
  clientId: string;
  redirectUri: string;
  exp: number; // epoch ms
  used: boolean;
}

const PATH = resolve(process.cwd(), "data/oauth-codes.json");
const TTL_MS = 90 * 1000;

function ensureDir() {
  const d = dirname(PATH);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function read(): Record<string, Code> {
  ensureDir();
  if (!existsSync(PATH)) return {};
  try { return JSON.parse(readFileSync(PATH, "utf-8")); } catch { return {}; }
}

function write(data: Record<string, Code>) {
  ensureDir();
  writeFileSync(PATH, JSON.stringify(data));
}

function prune(data: Record<string, Code>) {
  const now = Date.now();
  for (const code of Object.keys(data)) {
    const entry = data[code];
    if (entry.used || entry.exp < now) delete data[code];
  }
}

export function issueCode(clientId: string, redirectUri: string): string {
  const data = read();
  prune(data);
  const code = randomBytes(24).toString("base64url");
  data[code] = { code, clientId, redirectUri, exp: Date.now() + TTL_MS, used: false };
  write(data);
  return code;
}

// Returns true if the code matched all constraints. Single-use — marks it consumed.
export function consumeCode(code: string, clientId: string, redirectUri: string): boolean {
  const data = read();
  prune(data);
  const entry = data[code];
  if (!entry) return false;
  if (entry.used) return false;
  if (entry.clientId !== clientId) return false;
  if (entry.redirectUri !== redirectUri) return false;
  if (entry.exp < Date.now()) return false;
  entry.used = true;
  data[code] = entry;
  write(data);
  return true;
}
