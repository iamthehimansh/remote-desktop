// Idempotent bootstrap: ensures COOKIE_SUFFIX and OAUTH_CLIENT_DB_SECRET exist in .env.local.
import { readFileSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";
import { resolve } from "path";

const envPath = resolve(__dirname, "../.env.local");

function ensureEnvVar(content: string, key: string, generate: () => string): { content: string; value: string; created: boolean } {
  const regex = new RegExp(`^${key}=(.*)$`, "m");
  const match = content.match(regex);
  if (match && match[1]?.trim()) {
    return { content, value: match[1].trim(), created: false };
  }
  const value = generate();
  const line = `${key}=${value}`;
  const next = match ? content.replace(regex, line) : content.trimEnd() + `\n${line}\n`;
  return { content: next, value, created: true };
}

function main() {
  let env = "";
  try { env = readFileSync(envPath, "utf-8"); } catch {}

  const suffix = ensureEnvVar(env, "COOKIE_SUFFIX", () => randomBytes(3).toString("hex"));
  env = suffix.content;

  const dbSecret = ensureEnvVar(env, "OAUTH_CLIENT_DB_SECRET", () => randomBytes(32).toString("hex"));
  env = dbSecret.content;

  writeFileSync(envPath, env);

  console.log(`COOKIE_SUFFIX=${suffix.value} ${suffix.created ? "(generated)" : "(existing)"}`);
  console.log(`OAUTH_CLIENT_DB_SECRET=${dbSecret.value.slice(0, 8)}... ${dbSecret.created ? "(generated)" : "(existing)"}`);
}

main();
