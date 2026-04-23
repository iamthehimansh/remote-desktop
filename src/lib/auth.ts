import { compare } from "bcryptjs";
import { sign, verify } from "jsonwebtoken";
import { serialize } from "cookie";

const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

// Dashboard session cookie. Scoped to pc.himansh.in only.
// Name uses a fixed random suffix from env so no app can ever collide on the name.
export function getCookieName(): string {
  const suffix = process.env.COOKIE_SUFFIX || "nosuffix";
  return `__Secure-pcdash-local-${suffix}`;
}

export async function verifyPassword(plain: string): Promise<boolean> {
  const hash = process.env.DASHBOARD_PASSWORD_HASH;
  if (!hash) return false;
  return compare(plain, hash);
}

export function signToken(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  return sign({ sub: "admin", kind: "dashboard" }, secret, { expiresIn: "7d" });
}

export function verifyToken(token: string): { sub: string } | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    return verify(token, secret) as { sub: string };
  } catch {
    return null;
  }
}

export function createSessionCookie(token: string): string {
  return serialize(getCookieName(), token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export function clearSessionCookie(): string {
  return serialize(getCookieName(), "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
