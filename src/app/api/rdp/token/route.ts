import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Exchange Guacamole creds (stored server-side) for an auth token.
// The client uses this token in the iframe URL so Guacamole auto-logs in
// without ever exposing credentials to the browser.
export async function POST() {
  const username = process.env.GUAC_USERNAME;
  const password = process.env.GUAC_PASSWORD;

  if (!username || !password) {
    return NextResponse.json({ error: "Guacamole credentials not configured" }, { status: 500 });
  }

  try {
    const form = new URLSearchParams();
    form.set("username", username);
    form.set("password", password);

    const res = await fetch("http://localhost:8080/guacamole/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Guacamole auth failed: ${res.status} ${text.slice(0, 200)}` }, { status: 502 });
    }

    const data = await res.json();
    // Guacamole returns { authToken, username, dataSource, availableDataSources }
    return NextResponse.json({ token: data.authToken, dataSource: data.dataSource });
  } catch (err: any) {
    return NextResponse.json({ error: "Could not reach Guacamole" }, { status: 502 });
  }
}
