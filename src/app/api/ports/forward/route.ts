import { NextResponse } from "next/server";
import { createDNSRecord } from "@/lib/cloudflare";
import { addIngressRule } from "@/lib/tunnel-config";
import { addForward } from "@/lib/port-store";
import { randomBytes } from "crypto";

const RESERVED = new Set(["pc", "www", "mail", "api", "rdp", "ssh", "ftp", "ns1", "ns2", "mx", "smtp", "imap", "pop"]);
const RESERVED_PORTS = new Set([3005, 3006, 3389, 8080]);

export async function POST(request: Request) {
  try {
    const { localPort, subdomain, protocol = "http" } = await request.json();

    // Validate subdomain
    if (!subdomain || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(subdomain)) {
      return NextResponse.json(
        { error: "Invalid subdomain. Use lowercase letters, numbers, and hyphens." },
        { status: 400 }
      );
    }

    if (RESERVED.has(subdomain)) {
      return NextResponse.json({ error: "Reserved subdomain name" }, { status: 400 });
    }

    // Validate port
    const port = Number(localPort);
    if (!port || port < 1 || port > 65535) {
      return NextResponse.json({ error: "Invalid port number" }, { status: 400 });
    }

    if (RESERVED_PORTS.has(port)) {
      return NextResponse.json({ error: "Port is reserved by the dashboard" }, { status: 400 });
    }

    const hostname = `${subdomain}.himansh.in`;

    // 1. Create DNS CNAME record
    const dnsRecord = await createDNSRecord(subdomain);

    // 2. Add ingress rule via Cloudflare API (auto-applied, no restart)
    await addIngressRule(hostname, port, protocol);

    // 3. Store forward
    const forward = {
      id: `fwd_${randomBytes(6).toString("hex")}`,
      localPort: port,
      subdomain,
      hostname,
      protocol,
      dnsRecordId: dnsRecord.id,
      createdAt: new Date().toISOString(),
    };

    addForward(forward);

    return NextResponse.json(forward);
  } catch (error: any) {
    console.error("Port forward error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create port forward" },
      { status: 500 }
    );
  }
}
