import { NextResponse } from "next/server";
import { sign } from "jsonwebtoken";
import { consumeCode } from "@/lib/oauth-codes";
import { verifyClientSecret } from "@/lib/oauth-clients";

export const dynamic = "force-dynamic";

// Server-to-server: Worker exchanges code + client_secret for an app JWT.
// Not publicly usable; no CORS.
export async function POST(request: Request) {
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Basic ")) {
    return NextResponse.json({ error: "invalid_client" }, { status: 401 });
  }

  let clientId = "";
  let clientSecret = "";
  try {
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf-8");
    const colon = decoded.indexOf(":");
    clientId = decoded.slice(0, colon);
    clientSecret = decoded.slice(colon + 1);
  } catch {
    return NextResponse.json({ error: "invalid_client" }, { status: 401 });
  }

  if (!verifyClientSecret(clientId, clientSecret)) {
    return NextResponse.json({ error: "invalid_client" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { code, redirectUri } = body;

  if (!code || !redirectUri) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (!consumeCode(code, clientId, redirectUri)) {
    return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  const token = sign({ sub: "admin", kind: "app", app: clientId }, secret, { expiresIn: "24h" });

  return NextResponse.json({
    access_token: token,
    token_type: "Bearer",
    expires_in: 24 * 3600,
  });
}
