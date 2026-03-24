import { NextResponse } from "next/server";
import { authenticator } from "otplib";
import { getTOTP, setTOTP } from "@/lib/auth-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { code } = await request.json();

  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "Code required" }, { status: 400 });
  }

  const totp = getTOTP();
  if (!totp || !totp.secret) {
    return NextResponse.json(
      { error: "TOTP not set up. Call /api/auth/totp/setup first." },
      { status: 400 }
    );
  }

  const valid = authenticator.verify({ token: code, secret: totp.secret });

  if (!valid) {
    return NextResponse.json({ error: "Invalid code" }, { status: 401 });
  }

  setTOTP({ ...totp, enabled: true, enabledAt: new Date().toISOString() });

  return NextResponse.json({ success: true });
}

// DELETE to disable TOTP
export async function DELETE() {
  setTOTP(null);
  return NextResponse.json({ success: true });
}
