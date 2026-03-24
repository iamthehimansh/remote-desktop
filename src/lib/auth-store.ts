import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";

export interface StoredPasskey {
  id: string;
  publicKey: string; // base64url encoded
  counter: number;
  transports?: string[];
  createdAt: string;
  name: string;
}

export interface TOTPConfig {
  secret: string;
  enabled: boolean;
  enabledAt?: string;
}

export interface AuthData {
  passkeys: StoredPasskey[];
  totp: TOTPConfig | null;
}

const AUTH_DATA_PATH = resolve(process.cwd(), "data/auth.json");

function ensureDir() {
  const dir = dirname(AUTH_DATA_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function readAuthData(): AuthData {
  ensureDir();
  if (!existsSync(AUTH_DATA_PATH)) {
    const initial: AuthData = { passkeys: [], totp: null };
    writeFileSync(AUTH_DATA_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(readFileSync(AUTH_DATA_PATH, "utf-8"));
}

export function writeAuthData(data: AuthData): void {
  ensureDir();
  writeFileSync(AUTH_DATA_PATH, JSON.stringify(data, null, 2));
}

export function getPasskeys(): StoredPasskey[] {
  return readAuthData().passkeys;
}

export function addPasskey(passkey: StoredPasskey): void {
  const data = readAuthData();
  data.passkeys.push(passkey);
  writeAuthData(data);
}

export function removePasskey(id: string): void {
  const data = readAuthData();
  data.passkeys = data.passkeys.filter((p) => p.id !== id);
  writeAuthData(data);
}

export function updatePasskeyCounter(id: string, counter: number): void {
  const data = readAuthData();
  const passkey = data.passkeys.find((p) => p.id === id);
  if (passkey) {
    passkey.counter = counter;
    writeAuthData(data);
  }
}

export function getTOTP(): TOTPConfig | null {
  return readAuthData().totp;
}

export function setTOTP(totp: TOTPConfig | null): void {
  const data = readAuthData();
  data.totp = totp;
  writeAuthData(data);
}

export function hasPasskeys(): boolean {
  return getPasskeys().length > 0;
}

export function hasTOTP(): boolean {
  const totp = getTOTP();
  return totp !== null && totp.enabled;
}
