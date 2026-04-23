// OAuth client registry — one entry per app that has authEnabled=true.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { randomBytes, timingSafeEqual } from "crypto";

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
  createdAt: string;
}

const PATH = resolve(process.cwd(), "data/oauth-clients.json");

function ensureDir() {
  const d = dirname(PATH);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function read(): Record<string, OAuthClient> {
  ensureDir();
  if (!existsSync(PATH)) return {};
  try { return JSON.parse(readFileSync(PATH, "utf-8")); } catch { return {}; }
}

function write(data: Record<string, OAuthClient>) {
  ensureDir();
  writeFileSync(PATH, JSON.stringify(data, null, 2));
}

export function addClient(clientId: string, redirectUris: string[]): OAuthClient {
  const clients = read();
  const existing = clients[clientId];
  const clientSecret = existing?.clientSecret ?? randomBytes(32).toString("hex");
  const client: OAuthClient = {
    clientId,
    clientSecret,
    redirectUris,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  clients[clientId] = client;
  write(clients);
  return client;
}

export function removeClient(clientId: string) {
  const clients = read();
  delete clients[clientId];
  write(clients);
}

export function getClient(clientId: string): OAuthClient | undefined {
  return read()[clientId];
}

export function listClients(): OAuthClient[] {
  return Object.values(read());
}

export function verifyClientSecret(clientId: string, secret: string): boolean {
  const client = getClient(clientId);
  if (!client) return false;
  const a = Buffer.from(client.clientSecret);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isValidRedirect(clientId: string, uri: string): boolean {
  const client = getClient(clientId);
  if (!client) return false;
  return client.redirectUris.includes(uri);
}
