import { NextResponse } from "next/server";
import { hasPasskeys, hasTOTP } from "@/lib/auth-store";

export const dynamic = "force-dynamic";

// Password login is intentionally disabled — only passkey and TOTP are allowed.
const PASSWORD_LOGIN_DISABLED = true;

// Public endpoint - tells login page which methods are available
export async function GET() {
  return NextResponse.json({
    password: !PASSWORD_LOGIN_DISABLED,
    passkey: hasPasskeys(),
    totp: hasTOTP(),
  });
}
