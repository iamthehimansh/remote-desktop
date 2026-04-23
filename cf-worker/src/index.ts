import { verifyJwt, signJwt } from "./jwt";
import { renderLoginHtml } from "./login-ui";

interface Env {
  JWT_SECRET: string;
  COOKIE_SUFFIX: string;
  DASHBOARD_URL: string;
  OAUTH_CLIENT_SECRETS: string; // JSON string: { <clientId>: <secret> }
  PCDASH_RL: KVNamespace;
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function getAppId(host: string): string {
  return host.split(".")[0];
}

function cookieName(appId: string, suffix: string): string {
  return `__Secure-pcdash-app-${appId}-${suffix}`;
}

async function rateLimit(env: Env, ip: string): Promise<boolean> {
  const key = `rl:${ip}:${Math.floor(Date.now() / 60000)}`;
  const current = parseInt((await env.PCDASH_RL.get(key)) || "0", 10);
  if (current >= 20) return true;
  await env.PCDASH_RL.put(key, String(current + 1), { expirationTtl: 120 });
  return false;
}

async function getClientSecret(env: Env, appId: string): Promise<string | null> {
  try {
    const secrets = JSON.parse(env.OAUTH_CLIENT_SECRETS || "{}") as Record<string, string>;
    return secrets[appId] || null;
  } catch {
    return null;
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const host = url.hostname;
    const appId = getAppId(host);
    const path = url.pathname;

    // Rate limit auth-sensitive paths
    const ip = req.headers.get("cf-connecting-ip") || "unknown";

    // ---- Internal endpoints on this subdomain ----
    if (path.startsWith("/__pcdash/")) {
      if (await rateLimit(env, ip)) {
        return new Response("Too many requests", { status: 429 });
      }

      if (path === "/__pcdash/callback" && req.method === "POST") {
        return handleCallbackPost(req, env, appId);
      }
      if (path === "/__pcdash/callback" && req.method === "GET") {
        // Passkey popup lands here — bridge via postMessage to opener then close
        return handlePopupCallback(url);
      }
      if (path === "/__pcdash/logout" && req.method === "POST") {
        return handleLogout(appId, env);
      }
      if (path === "/__pcdash/methods" && req.method === "GET") {
        return fetchAuthMethods(env);
      }
      return new Response("Not found", { status: 404 });
    }

    // ---- Cookie check ----
    const cookies = parseCookies(req.headers.get("cookie") || "");
    const token = cookies[cookieName(appId, env.COOKIE_SUFFIX)];
    if (token) {
      const payload = await verifyJwt(token, env.JWT_SECRET);
      if (payload && payload.app === appId && payload.kind === "app") {
        // Authenticated — strip our cookie from outgoing request so the origin app never sees it
        const forwardReq = stripOurCookie(req, cookieName(appId, env.COOKIE_SUFFIX));
        return fetch(forwardReq);
      }
    }

    // ---- Not authenticated: decide between login page vs 401 ----
    const accept = req.headers.get("accept") || "";
    if (!accept.includes("text/html")) {
      // AJAX / WebSocket / other — just 401
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Render login UI on this same subdomain
    const methods = await fetchMethodsJson(env).catch(() => ({ totp: false, passkey: false }));
    const html = renderLoginHtml({
      appId,
      appTitle: titleFor(appId),
      dashboardUrl: env.DASHBOARD_URL,
      redirectUri: `${url.protocol}//${host}/__pcdash/callback`,
      returnPath: url.pathname + url.search,
      totpEnabled: !!methods.totp,
      passkeyEnabled: !!methods.passkey,
    });
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  },
};

function stripOurCookie(req: Request, name: string): Request {
  const h = new Headers(req.headers);
  const raw = h.get("cookie") || "";
  const next = raw.split(";")
    .map((s) => s.trim())
    .filter((s) => !s.startsWith(name + "="))
    .join("; ");
  if (next) h.set("cookie", next);
  else h.delete("cookie");
  return new Request(req, { headers: h });
}

async function handleCallbackPost(req: Request, env: Env, appId: string): Promise<Response> {
  const { code, redirectUri } = await req.json().catch(() => ({} as any));
  if (!code || !redirectUri) return new Response(JSON.stringify({ error: "bad_request" }), { status: 400 });

  const clientSecret = await getClientSecret(env, appId);
  if (!clientSecret) return new Response(JSON.stringify({ error: "unknown_client" }), { status: 401 });

  const res = await fetch(`${env.DASHBOARD_URL}/api/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + btoa(`${appId}:${clientSecret}`),
    },
    body: JSON.stringify({ code, redirectUri }),
  });
  if (!res.ok) return new Response(JSON.stringify({ error: "exchange_failed" }), { status: 502 });

  const data = (await res.json()) as { access_token: string };

  // Verify the token signature (defense-in-depth)
  const payload = await verifyJwt(data.access_token, env.JWT_SECRET);
  if (!payload || payload.app !== appId) {
    return new Response(JSON.stringify({ error: "bad_token" }), { status: 502 });
  }

  const name = cookieName(appId, env.COOKIE_SUFFIX);
  const cookie = `${name}=${data.access_token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${24 * 3600}`;
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": cookie },
  });
}

function handlePopupCallback(url: URL): Response {
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const error = url.searchParams.get("error") || "";
  const html = `<!doctype html><html><body><script>
    (function(){
      try {
        if (window.opener) {
          window.opener.postMessage({ type: "pcdash_code", code: ${JSON.stringify(code)}, state: ${JSON.stringify(state)}, error: ${JSON.stringify(error)} }, "*");
        }
      } catch(e) {}
      window.close();
    })();
  </script>You can close this window.</body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
}

function handleLogout(appId: string, env: Env): Response {
  const name = cookieName(appId, env.COOKIE_SUFFIX);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    },
  });
}

async function fetchAuthMethods(env: Env): Promise<Response> {
  const methods = await fetchMethodsJson(env).catch(() => ({ password: true, totp: false, passkey: false }));
  return new Response(JSON.stringify(methods), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function fetchMethodsJson(env: Env): Promise<{ totp: boolean; passkey: boolean; password: boolean }> {
  const res = await fetch(`${env.DASHBOARD_URL}/api/auth/methods`, { cf: { cacheTtl: 30 } as any });
  if (!res.ok) return { totp: false, passkey: false, password: true };
  return (await res.json()) as any;
}

function titleFor(appId: string): string {
  const map: Record<string, string> = {
    jupyter: "Jupyter Notebook",
    code: "VS Code Web",
    ai: "Open WebUI",
  };
  return map[appId] || appId;
}
