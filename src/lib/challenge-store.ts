import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";

// File-based challenge store — survives Next.js hot reloads in dev mode

const STORE_PATH = resolve(process.cwd(), "data/challenges.json");

interface ChallengeData {
  registration: Record<string, { challenge: string; expires: number }>;
  authentication: Record<string, { challenge: string; expires: number }>;
}

function ensureDir() {
  const dir = dirname(STORE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readStore(): ChallengeData {
  ensureDir();
  if (!existsSync(STORE_PATH)) {
    return { registration: {}, authentication: {} };
  }
  try {
    return JSON.parse(readFileSync(STORE_PATH, "utf-8"));
  } catch {
    return { registration: {}, authentication: {} };
  }
}

function writeStore(data: ChallengeData) {
  ensureDir();
  writeFileSync(STORE_PATH, JSON.stringify(data));
}

const TTL = 5 * 60 * 1000; // 5 minutes

export function setRegistrationChallenge(userId: string, challenge: string) {
  const store = readStore();
  store.registration[userId] = { challenge, expires: Date.now() + TTL };
  writeStore(store);
}

export function getRegistrationChallenge(userId: string): string | undefined {
  const store = readStore();
  const entry = store.registration[userId];
  if (!entry || Date.now() > entry.expires) return undefined;
  return entry.challenge;
}

export function deleteRegistrationChallenge(userId: string) {
  const store = readStore();
  delete store.registration[userId];
  writeStore(store);
}

export function setAuthenticationChallenge(userId: string, challenge: string) {
  const store = readStore();
  store.authentication[userId] = { challenge, expires: Date.now() + TTL };
  writeStore(store);
}

export function getAuthenticationChallenge(userId: string): string | undefined {
  const store = readStore();
  const entry = store.authentication[userId];
  if (!entry || Date.now() > entry.expires) return undefined;
  return entry.challenge;
}

export function deleteAuthenticationChallenge(userId: string) {
  const store = readStore();
  delete store.authentication[userId];
  writeStore(store);
}
