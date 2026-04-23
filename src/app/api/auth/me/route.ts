import { NextResponse } from "next/server";
import { verifyToken, getCookieName } from "@/lib/auth";
import { hasPasskeys, hasTOTP } from "@/lib/auth-store";
import { parse } from "cookie";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookies = parse(cookieHeader);
  const token = cookies[getCookieName()];

  if (!token) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: payload.sub,
    methods: {
      password: true,
      passkey: hasPasskeys(),
      totp: hasTOTP(),
    },
  });
}
