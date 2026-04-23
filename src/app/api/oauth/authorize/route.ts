import { NextResponse } from "next/server";
import { verifyToken, getCookieName } from "@/lib/auth";
import { issueCode } from "@/lib/oauth-codes";
import { isValidRedirect, getClient } from "@/lib/oauth-clients";
import { parse } from "cookie";

export const dynamic = "force-dynamic";

// GET /api/oauth/authorize?client_id=...&redirect_uri=...&state=...&prompt=silent|auto
// - If user is logged in to dashboard: 302 to redirect_uri?code=...&state=...
// - If not logged in and prompt=silent: 302 back with ?error=login_required
// - Else: 302 to /login?return=<this url>
export async function GET(request: Request) {
  // Build URL using the Host header so redirects stay on pc.himansh.in
  // (otherwise Next.js can resolve request.url against localhost)
  const host = request.headers.get("host") || "pc.himansh.in";
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const proto = forwardedProto || (host.startsWith("localhost") ? "http" : "https");
  const reqUrl = new URL(request.url);
  const url = new URL(reqUrl.pathname + reqUrl.search, `${proto}://${host}`);
  const clientId = url.searchParams.get("client_id") || "";
  const redirectUri = url.searchParams.get("redirect_uri") || "";
  const state = url.searchParams.get("state") || "";
  const prompt = url.searchParams.get("prompt") || "";

  if (!getClient(clientId)) {
    return NextResponse.json({ error: "invalid_client" }, { status: 400 });
  }
  if (!isValidRedirect(clientId, redirectUri)) {
    return NextResponse.json({ error: "invalid_redirect_uri" }, { status: 400 });
  }

  // Read dashboard session cookie
  const cookieHeader = request.headers.get("cookie") || "";
  const cookies = parse(cookieHeader);
  const token = cookies[getCookieName()];
  const session = token ? verifyToken(token) : null;

  if (session) {
    const code = issueCode(clientId, redirectUri);
    const back = new URL(redirectUri);
    back.searchParams.set("code", code);
    if (state) back.searchParams.set("state", state);
    return NextResponse.redirect(back);
  }

  // Not logged in
  if (prompt === "silent") {
    const back = new URL(redirectUri);
    back.searchParams.set("error", "login_required");
    if (state) back.searchParams.set("state", state);
    return NextResponse.redirect(back);
  }

  // Interactive login — redirect to dashboard login, come back here after
  const loginUrl = new URL("/login", `${proto}://${host}`);
  loginUrl.searchParams.set("return", url.pathname + url.search);
  return NextResponse.redirect(loginUrl);
}
