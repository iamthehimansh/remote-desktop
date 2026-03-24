import { NextResponse } from "next/server";
import { authenticator } from "otplib";
import { toDataURL } from "qrcode";
import { setTOTP, getTOTP } from "@/lib/auth-store";

export async function POST() {
  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri("admin", "PC Dashboard", secret);
  const qrCodeDataUrl = await toDataURL(otpauthUrl);

  // Store secret but mark as not yet enabled (needs verification)
  setTOTP({ secret, enabled: false });

  return NextResponse.json({
    secret,
    qrCode: qrCodeDataUrl,
    otpauthUrl,
  });
}

export async function GET() {
  const totp = getTOTP();
  return NextResponse.json({
    enabled: totp?.enabled ?? false,
  });
}
