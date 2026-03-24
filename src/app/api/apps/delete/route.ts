import { NextResponse } from "next/server";
import { getApp, removeApp } from "@/lib/app-store";
import { deleteDNSRecord } from "@/lib/cloudflare";
import { removeIngressRule } from "@/lib/tunnel-config";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  try {
    const { id } = await request.json();
    const app = getApp(id);

    if (!app) {
      return NextResponse.json({ error: "App not found" }, { status: 404 });
    }

    // Clean up DNS if exists
    if (app.dnsRecordId) {
      try {
        await deleteDNSRecord(app.dnsRecordId);
      } catch {}
    }

    // Clean up ingress
    try {
      await removeIngressRule(`${app.subdomain}.himansh.in`);
    } catch {}

    removeApp(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
