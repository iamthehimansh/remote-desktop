const API_BASE = "https://api.cloudflare.com/client/v4";

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

export async function createDNSRecord(subdomain: string): Promise<{ id: string; name: string }> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const tunnelId = process.env.TUNNEL_ID;

  const res = await fetch(`${API_BASE}/zones/${zoneId}/dns_records`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      type: "CNAME",
      name: subdomain,
      content: `${tunnelId}.cfargotunnel.com`,
      proxied: true,
      comment: "Created by PC Dashboard",
    }),
  });

  const data = await res.json();
  if (!data.success) {
    throw new Error(data.errors?.[0]?.message || "Failed to create DNS record");
  }

  return { id: data.result.id, name: data.result.name };
}

export async function deleteDNSRecord(recordId: string): Promise<void> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;

  const res = await fetch(`${API_BASE}/zones/${zoneId}/dns_records/${recordId}`, {
    method: "DELETE",
    headers: getHeaders(),
  });

  const data = await res.json();
  if (!data.success) {
    throw new Error(data.errors?.[0]?.message || "Failed to delete DNS record");
  }
}

export async function listDNSRecords(): Promise<Array<{ id: string; name: string; content: string }>> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;

  const res = await fetch(
    `${API_BASE}/zones/${zoneId}/dns_records?type=CNAME&per_page=100&comment.contains=PC Dashboard`,
    { headers: getHeaders() }
  );

  const data = await res.json();
  if (!data.success) return [];

  return data.result.map((r: any) => ({
    id: r.id,
    name: r.name,
    content: r.content,
  }));
}
