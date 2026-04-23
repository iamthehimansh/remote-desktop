import { NextResponse } from "next/server";
import { parse } from "cookie";
import { verifyToken, getCookieName } from "@/lib/auth";

// Returns the session token for WebSocket auth (since cookies are HttpOnly)
export async function GET(request: Request) {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookies = parse(cookieHeader);
  const token = cookies[getCookieName()];

  if (!token || !verifyToken(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ token });
}
