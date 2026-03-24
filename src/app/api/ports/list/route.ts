import { NextResponse } from "next/server";
import { getForwards } from "@/lib/port-store";
import { createConnection } from "net";

export const dynamic = "force-dynamic";

async function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export async function GET() {
  const forwards = getForwards();

  const withStatus = await Promise.all(
    forwards.map(async (f) => ({
      ...f,
      status: (await checkPort(f.localPort)) ? "active" : "unreachable",
    }))
  );

  return NextResponse.json({ forwards: withStatus });
}
