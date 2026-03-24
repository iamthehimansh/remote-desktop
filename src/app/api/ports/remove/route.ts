import { NextResponse } from "next/server";
import { deleteDNSRecord } from "@/lib/cloudflare";
import { removeIngressRule, reloadTunnel } from "@/lib/tunnel-config";
import { removeForward } from "@/lib/port-store";

export async function DELETE(request: Request) {
  try {
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: "Forward ID required" }, { status: 400 });
    }

    const forward = removeForward(id);
    if (!forward) {
      return NextResponse.json({ error: "Forward not found" }, { status: 404 });
    }

    // 1. Delete DNS record
    try {
      await deleteDNSRecord(forward.dnsRecordId);
    } catch (err) {
      console.warn("DNS record deletion failed:", err);
    }

    // 2. Remove ingress rule
    removeIngressRule(forward.hostname);

    // 3. Reload tunnel
    try {
      await reloadTunnel();
    } catch (err) {
      console.warn("Tunnel reload failed:", err);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Port remove error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to remove port forward" },
      { status: 500 }
    );
  }
}
