import { compare } from "bcryptjs";
import { sign, verify } from "jsonwebtoken";
import { serialize } from "cookie";

const COOKIE_NAME = "session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export { COOKIE_NAME };

export async function verifyPassword(plain: string): Promise<boolean> {
  const hash = process.env.DASHBOARD_PASSWORD_HASH;
  if (!hash) return false;
  return compare(plain, hash);
}

export function signToken(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  return sign({ sub: "admin" }, secret, { expiresIn: "7d" });
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
  return serialize(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export function clearSessionCookie(): string {
  return serialize(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}
