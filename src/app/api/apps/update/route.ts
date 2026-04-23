import { NextResponse } from "next/server";
import { getApp, updateApp } from "@/lib/app-store";
import { addClient, removeClient, listClients } from "@/lib/oauth-clients";
import { addWorkerRoute, removeWorkerRoute, syncWorkerSecrets } from "@/lib/cf-worker";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, username, password, port, subdomain, command, authEnabled } = body;

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

    // Auth toggle
    if (authEnabled !== undefined && authEnabled !== !!app.authEnabled) {
      const hostname = `${app.subdomain}.himansh.in`;
      const redirectUri = `https://${hostname}/__pcdash/callback`;

      if (authEnabled) {
        // Turn ON: register OAuth client, add Worker route, sync secrets
        addClient(app.subdomain, [redirectUri]);
        try {
          const routeId = await addWorkerRoute(hostname);
          updates.workerRouteId = routeId;
        } catch (err: any) {
          // Roll back client registration if route creation fails
          removeClient(app.subdomain);
          return NextResponse.json({ error: `Failed to add Worker route: ${err.message}` }, { status: 500 });
        }
        await syncSecretsToWorker();
        updates.authEnabled = true;
      } else {
        // Turn OFF: remove route, remove client, resync
        if (app.workerRouteId) {
          try { await removeWorkerRoute(app.workerRouteId); } catch {}
        }
        removeClient(app.subdomain);
        await syncSecretsToWorker();
        updates.authEnabled = false;
        updates.workerRouteId = undefined;
      }
    }

    updateApp(id, updates);

    return NextResponse.json({ success: true, authEnabled: updates.authEnabled ?? app.authEnabled });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function syncSecretsToWorker() {
  const clients = listClients();
  const secrets: Record<string, string> = {};
  for (const c of clients) secrets[c.clientId] = c.clientSecret;
  try { await syncWorkerSecrets(secrets); } catch {}
}
