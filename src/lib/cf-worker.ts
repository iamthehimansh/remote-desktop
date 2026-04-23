// Cloudflare Worker route management + secret sync for the pcdash-gate Worker.
const API_BASE = "https://api.cloudflare.com/client/v4";
const WORKER_NAME = "pcdash-gate";

function headers() {
  return {
    Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

export async function addWorkerRoute(hostname: string): Promise<string> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const pattern = `${hostname}/*`;

  const res = await fetch(`${API_BASE}/zones/${zoneId}/workers/routes`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ pattern, script: WORKER_NAME }),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.errors?.[0]?.message || "Failed to create Worker route");
  }
  return data.result.id as string;
}

export async function removeWorkerRoute(routeId: string): Promise<void> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const res = await fetch(`${API_BASE}/zones/${zoneId}/workers/routes/${routeId}`, {
    method: "DELETE",
    headers: headers(),
  });
  const data = await res.json();
  if (!data.success) {
    // Route might already be deleted, not a fatal error
    console.warn("Worker route delete warning:", JSON.stringify(data.errors));
  }
}

// Sync the per-app client secrets into the Worker's secret env.
// Called whenever a client is added/removed.
export async function syncWorkerSecrets(clientSecrets: Record<string, string>): Promise<void> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const payload = JSON.stringify(clientSecrets);

  const res = await fetch(
    `${API_BASE}/accounts/${accountId}/workers/scripts/${WORKER_NAME}/secrets`,
    {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ name: "OAUTH_CLIENT_SECRETS", text: payload, type: "secret_text" }),
    }
  );

  const data = await res.json();
  if (!data.success) {
    console.warn("Worker secret sync warning:", JSON.stringify(data.errors));
  }
}
