import { NextResponse } from "next/server";
import { hasPasskeys, hasTOTP } from "@/lib/auth-store";

// Public endpoint - tells login page which methods are available
export async function GET() {
  return NextResponse.json({
    password: true,
    passkey: hasPasskeys(),
    totp: hasTOTP(),
  });
}
