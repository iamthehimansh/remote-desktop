import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/passkey/login-options",
  "/api/auth/passkey/login",
  "/api/auth/totp/login",
  "/api/auth/methods",
  "/api/oauth/password",   // CORS endpoint used by Worker login UI
  "/api/oauth/totp",       // CORS endpoint used by Worker login UI
  "/api/oauth/authorize",  // handles its own auth via dashboard cookie
  "/api/oauth/token",      // server-to-server, verifies client secret itself
  "/api/oauth/userinfo",   // verifies Bearer token itself
  "/.well-known/openid-configuration",
];

function cookieName(): string {
  const suffix = process.env.COOKIE_SUFFIX || "nosuffix";
  return `__Secure-pcdash-local-${suffix}`;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(cookieName())?.value;

  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    // preserve return target (like /app/<id>?return=...)
    if (pathname !== "/login") loginUrl.searchParams.set("return", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    await jwtVerify(token, secret);
    return NextResponse.next();
  } catch {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/login") loginUrl.searchParams.set("return", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*", "/guacamole/:path*", "/app/:path*"],
};
