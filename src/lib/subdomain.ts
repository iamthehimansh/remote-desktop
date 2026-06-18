import { randomBytes } from "crypto";

// Reserved names that must never be handed out as a tunnel/forward subdomain.
// Includes infra/service names + the static names already live on himansh.in so
// a tunnel can never shadow a real service. (Dynamic port-forward names are
// checked separately at runtime where the forward list is available.)
export const RESERVED_SUBDOMAINS = new Set([
  // generic infra
  "pc", "www", "mail", "api", "rdp", "ftp", "ns1", "ns2", "mx", "smtp", "imap", "pop",
  // this project's own hostnames / entry points
  "ssh", "names", "desk", "screen",
]);

// Lowercase letters, digits and hyphens; no leading/trailing hyphen; 1-63 chars.
const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function isValidSubdomain(name: string): boolean {
  return typeof name === "string" && name.length >= 1 && name.length <= 63 && SUBDOMAIN_RE.test(name);
}

export function isReservedSubdomain(name: string): boolean {
  return RESERVED_SUBDOMAINS.has(name);
}

// Suggest a handful of alternative names when the requested one is taken/invalid.
// `isTaken` lets the caller plug in live availability (tunnels + port-forwards).
export function suggestAlternatives(name: string, isTaken: (candidate: string) => boolean): string[] {
  const base = (name || "app").toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "") || "app";
  const candidates = [
    `${base}-2`,
    `${base}-app`,
    `${base}-${randomBytes(2).toString("hex")}`,
    `${base}-${randomBytes(3).toString("hex")}`,
  ];
  const out: string[] = [];
  for (const c of candidates) {
    if (isValidSubdomain(c) && !isReservedSubdomain(c) && !isTaken(c) && !out.includes(c)) {
      out.push(c);
    }
    if (out.length >= 3) break;
  }
  return out;
}

// A random, pronounceable-ish name for when the user doesn't pick one.
export function randomSubdomain(): string {
  return `t-${randomBytes(4).toString("hex")}`;
}
