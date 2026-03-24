import { NextResponse } from "next/server";
import { getApp, updateApp } from "@/lib/app-store";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const { id, username, password, port, subdomain, command } = await request.json();

    if (!id) {
      return NextResponse.json({ error: "App ID required" }, { status: 400 });
    }

    const app = getApp(id);
    if (!app) {
      return NextResponse.json({ error: "App not found" }, { status: 404 });
    }

    const updates: Record<string, any> = {};
    if (username !== undefined) updates.username = username;
    if (password !== undefined) updates.password = password;
    if (port !== undefined) updates.port = Number(port);
    if (subdomain !== undefined) updates.subdomain = subdomain;
    if (command !== undefined) updates.command = command;

    updateApp(id, updates);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
