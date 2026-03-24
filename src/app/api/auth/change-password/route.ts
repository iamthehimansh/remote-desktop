import { NextResponse } from "next/server";
import { verifyPassword } from "@/lib/auth";
import { hash } from "bcryptjs";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { currentPassword, newPassword } = await request.json();

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Both passwords required" }, { status: 400 });
  }

  if (newPassword.length < 4) {
    return NextResponse.json({ error: "Password must be at least 4 characters" }, { status: 400 });
  }

  // Verify current password
  const valid = await verifyPassword(currentPassword);
  if (!valid) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }

  // Hash new password and update .env.local
  const newHash = await hash(newPassword, 12);
  const escapedHash = newHash.replace(/\$/g, "\\$");

  const envPath = resolve(process.cwd(), ".env.local");
  let envContent = readFileSync(envPath, "utf-8");

  const regex = /^DASHBOARD_PASSWORD_HASH=.*$/m;
  if (regex.test(envContent)) {
    envContent = envContent.replace(regex, `DASHBOARD_PASSWORD_HASH=${escapedHash}`);
  } else {
    envContent += `\nDASHBOARD_PASSWORD_HASH=${escapedHash}`;
  }

  writeFileSync(envPath, envContent);

  // Update the running process env
  process.env.DASHBOARD_PASSWORD_HASH = newHash;

  return NextResponse.json({ success: true });
}
