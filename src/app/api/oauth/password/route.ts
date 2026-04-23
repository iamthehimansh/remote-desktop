import { NextResponse } from "next/server";
import { verifyPassword } from "@/lib/auth";
import { getTOTP, hasTOTP } from "@/lib/auth-store";
import { authenticator } from "otplib";
import { issueCode } from "@/lib/oauth-codes";
import { isValidRedirect, getClient } from "@/lib/oauth-clients";

export const dynamic = "force-dynamic";

// Rate limit: 5 failed attempts / minute / IP
const attempts = new Map<string, { count: number; resetAt: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (rec && now < rec.resetAt && rec.count >= 5) return true;
  return false;
}
function registerFail(ip: string) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || rec.resetAt < now) attempts.set(ip, { count: 1, resetAt: now + 60000 });
  else rec.count++;
}

function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  try {
    const u = new URL(origin);
    if (u.hostname === "pc.himansh.in" || u.hostname.endsWith(".himansh.in")) {
      return origin;
    }
  } catch {}
  return null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const ok = allowedOrigin(origin) || "null";
  return {
    "Access-Control-Allow-Origin": ok,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const headers = corsHeaders(origin);

  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429, headers });
  }

  const body = await request.json().catch(() => ({}));
  const { password, totp, clientId, redirectUri } = body;

  if (!password || !clientId || !redirectUri) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400, headers });
  }

  if (!getClient(clientId)) {
    return NextResponse.json({ error: "Unknown client" }, { status: 400, headers });
  }
  if (!isValidRedirect(clientId, redirectUri)) {
    return NextResponse.json({ error: "Invalid redirect_uri" }, { status: 400, headers });
  }

  const passOk = await verifyPassword(password);
  if (!passOk) {
    registerFail(ip);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401, headers });
  }

  // Require TOTP if enabled
  if (hasTOTP()) {
    const t = getTOTP();
    if (!totp || !t || !authenticator.verify({ token: String(totp), secret: t.secret })) {
      registerFail(ip);
      return NextResponse.json({ error: "TOTP required or invalid" }, { status: 401, headers });
    }
  }

  const code = issueCode(clientId, redirectUri);
  return NextResponse.json({ code }, { headers });
}
