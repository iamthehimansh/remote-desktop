import { NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";
import { resolve } from "path";
import { clearSessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Rotates JWT_SECRET. All existing dashboard + app cookies become invalid.
// Admin-only: relies on middleware already protecting this endpoint.
export async function POST() {
  const envPath = resolve(process.cwd(), ".env.local");
  let content: string;
  try {
    content = readFileSync(envPath, "utf-8");
  } catch (err: any) {
    return NextResponse.json({ error: "Could not read env file" }, { status: 500 });
  }

  const newSecret = randomBytes(32).toString("hex");
  const regex = /^JWT_SECRET=.*$/m;
  const updated = regex.test(content)
    ? content.replace(regex, `JWT_SECRET=${newSecret}`)
    : content.trimEnd() + `\nJWT_SECRET=${newSecret}\n`;

  writeFileSync(envPath, updated);
  process.env.JWT_SECRET = newSecret;

  const response = NextResponse.json({ success: true, message: "JWT_SECRET rotated. Sign out everywhere complete." });
  response.headers.set("Set-Cookie", clearSessionCookie());
  return response;
}
