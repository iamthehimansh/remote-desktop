import { NextResponse } from "next/server";
import { verifyPassword, signToken, createSessionCookie } from "@/lib/auth";

const attempts = new Map<string, { count: number; resetAt: number }>();

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";

  // Rate limiting: 5 attempts per minute
  const now = Date.now();
  const record = attempts.get(ip);
  if (record) {
    if (now < record.resetAt) {
      if (record.count >= 5) {
        return NextResponse.json(
          { error: "Too many attempts. Try again later." },
          { status: 429 }
        );
      }
    } else {
      attempts.delete(ip);
    }
  }

  const { password } = await request.json();

  if (!password || typeof password !== "string") {
    return NextResponse.json({ error: "Password required" }, { status: 400 });
  }

  const valid = await verifyPassword(password);

  if (!valid) {
    const entry = attempts.get(ip) || { count: 0, resetAt: now + 60000 };
    entry.count++;
    attempts.set(ip, entry);
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  attempts.delete(ip);
  const token = signToken();
  const response = NextResponse.json({ success: true });
  response.headers.set("Set-Cookie", createSessionCookie(token));
  return response;
}
