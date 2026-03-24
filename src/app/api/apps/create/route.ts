import { NextResponse } from "next/server";
import { addApp, type AppConfig } from "@/lib/app-store";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, command, port, subdomain, description, authType, authParam } = body;

    if (!name || !command || !port || !subdomain) {
      return NextResponse.json({ error: "name, command, port, subdomain are required" }, { status: 400 });
    }

    const app: AppConfig = {
      id: `app_${randomBytes(4).toString("hex")}`,
      name,
      icon: "Box",
      description: description || "",
      command,
      port: Number(port),
      subdomain,
      authType: authType || "none",
      authParam: authParam || undefined,
      status: "stopped",
      custom: true,
    };

    addApp(app);
    return NextResponse.json(app);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
