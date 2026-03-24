import { getSystemStats } from "@/lib/system-info";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller closed
        }
      };

      // Send initial stats immediately
      try {
        send(await getSystemStats());
      } catch {}

      // Push every 2 seconds
      const interval = setInterval(async () => {
        try {
          send(await getSystemStats());
        } catch {
          clearInterval(interval);
          try { controller.close(); } catch {}
        }
      }, 2000);

      // Cleanup on client disconnect
      request.signal.addEventListener("abort", () => {
        clearInterval(interval);
        try { controller.close(); } catch {}
      });

      // Safety: max 5 minutes per connection
      setTimeout(() => {
        clearInterval(interval);
        try { controller.close(); } catch {}
      }, 5 * 60 * 1000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
