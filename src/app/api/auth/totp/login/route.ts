import { NextResponse } from "next/server";
import { authenticator } from "otplib";
import { getTOTP } from "@/lib/auth-store";
import { signToken, createSessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { code } = await request.json();

  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "Code required" }, { status: 400 });
  }

  const totp = getTOTP();
  if (!totp || !totp.enabled) {
    return NextResponse.json(
      { error: "TOTP is not enabled" },
      { status: 400 }
    );
  }

  const valid = authenticator.verify({ token: code, secret: totp.secret });

  if (!valid) {
    return NextResponse.json({ error: "Invalid code" }, { status: 401 });
  }

  const token = signToken();
  const response = NextResponse.json({ success: true });
  response.headers.set("Set-Cookie", createSessionCookie(token));
  return response;
}
