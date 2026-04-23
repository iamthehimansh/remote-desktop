// Inline HTML login page served on the app subdomain.
// Dark theme matching the dashboard.

interface Options {
  appId: string;
  appTitle: string;         // friendly name ("Jupyter Notebook")
  dashboardUrl: string;     // e.g. https://pc.himansh.in
  redirectUri: string;      // callback on this same subdomain
  returnPath: string;       // where to land after successful auth
  totpEnabled: boolean;
  passkeyEnabled: boolean;
}

export function renderLoginHtml(opts: Options): string {
  const state = crypto.randomUUID();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in to ${escape(opts.appTitle)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;height:100%;background:#09090b;color:#fafafa;font-family:system-ui,-apple-system,sans-serif}
  body{display:grid;place-items:center;background:
    linear-gradient(rgba(59,130,246,.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(59,130,246,.03) 1px, transparent 1px);
    background-size:64px 64px}
  .card{width:400px;max-width:calc(100% - 32px);padding:28px;border-radius:12px;
    background:rgba(24,24,27,.8);backdrop-filter:blur(16px);border:1px solid #3f3f46}
  .brand{display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:4px}
  .brand svg{color:#3b82f6;width:20px;height:20px}
  .brand h1{margin:0;font-family:"JetBrains Mono",monospace;font-size:18px;font-weight:600}
  .sub{text-align:center;color:#a1a1aa;font-size:13px;margin-bottom:20px}
  .app{text-align:center;margin:14px 0 20px;font-size:14px}
  .app b{color:#3b82f6}
  .err{color:#ef4444;text-align:center;font-size:13px;min-height:18px;margin-bottom:8px}
  .loading{text-align:center;color:#a1a1aa;font-size:12px;padding:16px}
  input{width:100%;padding:10px 12px;border-radius:6px;background:#27272a;border:1px solid #3f3f46;
    color:#fafafa;font-size:14px;font-family:inherit;margin-bottom:10px}
  input:focus{outline:none;border-color:#3b82f6}
  input.totp{font-family:"JetBrains Mono",monospace;text-align:center;font-size:20px;letter-spacing:8px}
  button{width:100%;padding:10px;border-radius:6px;background:#3b82f6;color:#fff;border:none;
    font-size:14px;font-weight:500;cursor:pointer;font-family:inherit}
  button:hover{background:#2563eb}
  button:disabled{opacity:.5;cursor:not-allowed}
  button.secondary{background:#27272a;margin-top:8px}
  button.secondary:hover{background:#3f3f46}
  .row{display:flex;align-items:center;gap:8px;margin:14px 0;color:#52525b;font-size:12px}
  .row::before,.row::after{content:"";flex:1;height:1px;background:#3f3f46}
  .shake{animation:shake .4s}
  @keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}
  .hidden{display:none}
</style>
</head>
<body>
<div class="card" id="card">
  <div class="brand">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>
    <h1>PC Dashboard</h1>
  </div>
  <div class="sub">Sign in to continue</div>
  <div class="app">Opening <b>${escape(opts.appTitle)}</b></div>

  <div id="sso" class="loading">Checking session…</div>

  <form id="form" class="hidden" autocomplete="off">
    <div class="err" id="err"></div>
    <input type="password" id="pass" placeholder="Dashboard password" required autocomplete="current-password">
    ${opts.totpEnabled ? `<input class="totp" id="totp" placeholder="••••••" maxlength="6" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code">` : ``}
    <button type="submit" id="submit">Sign in</button>
    ${opts.passkeyEnabled ? `
    <div class="row">or</div>
    <button type="button" class="secondary" id="pkbtn">Sign in with Passkey</button>
    ` : ``}
  </form>
</div>
<script>
const APP = ${JSON.stringify({
    appId: opts.appId,
    dashboardUrl: opts.dashboardUrl,
    redirectUri: opts.redirectUri,
    returnPath: opts.returnPath,
    totpEnabled: opts.totpEnabled,
    passkeyEnabled: opts.passkeyEnabled,
    state,
  })};

const ssoEl = document.getElementById("sso");
const formEl = document.getElementById("form");
const errEl = document.getElementById("err");
const cardEl = document.getElementById("card");

function showForm() {
  ssoEl.classList.add("hidden");
  formEl.classList.remove("hidden");
}
function showError(msg) {
  errEl.textContent = msg;
  cardEl.classList.remove("shake");
  void cardEl.offsetWidth;
  cardEl.classList.add("shake");
}

// 1) Silent SSO attempt: see if the user is already logged in to the dashboard.
//    We do this by checking if the dashboard can issue an auth code for us.
async function trySilentSSO() {
  try {
    const url = new URL(APP.dashboardUrl + "/api/oauth/authorize");
    url.searchParams.set("client_id", APP.appId);
    url.searchParams.set("redirect_uri", APP.redirectUri);
    url.searchParams.set("state", APP.state);
    url.searchParams.set("prompt", "silent");
    // Use a window.location navigation (cookies on pc.himansh.in go with it).
    // If logged in, server redirects to redirectUri?code=...&state=...
    // If not, server redirects to redirectUri?error=login_required&state=...
    window.location.href = url.toString();
  } catch (e) {
    showForm();
  }
}

// If we landed back here with ?error=login_required, just show the form
const params = new URLSearchParams(location.search);
if (params.get("error") === "login_required") {
  showForm();
} else {
  trySilentSSO();
}

// Password + TOTP submit
formEl?.addEventListener("submit", async (e) => {
  e.preventDefault();
  errEl.textContent = "";
  const submitBtn = document.getElementById("submit");
  submitBtn.disabled = true;
  try {
    const pass = document.getElementById("pass").value;
    const totp = APP.totpEnabled ? document.getElementById("totp").value : undefined;
    const res = await fetch(APP.dashboardUrl + "/api/oauth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pass, totp, clientId: APP.appId, redirectUri: APP.redirectUri }),
    });
    const data = await res.json();
    if (!res.ok) {
      showError(data.error || "Sign in failed");
      return;
    }
    // Exchange code via Worker callback to set the per-app cookie
    const cbRes = await fetch("/__pcdash/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: data.code, redirectUri: APP.redirectUri }),
    });
    if (!cbRes.ok) { showError("Token exchange failed"); return; }
    location.href = APP.returnPath || "/";
  } catch (err) {
    showError("Network error");
  } finally {
    submitBtn.disabled = false;
  }
});

// Passkey — opens a popup to the dashboard's OAuth authorize endpoint
document.getElementById("pkbtn")?.addEventListener("click", () => {
  const url = new URL(APP.dashboardUrl + "/api/oauth/authorize");
  url.searchParams.set("client_id", APP.appId);
  url.searchParams.set("redirect_uri", APP.redirectUri);
  url.searchParams.set("state", APP.state);
  const popup = window.open(url.toString(), "pcdash_pk", "width=440,height=620,popup=yes");
  if (!popup) { showError("Popup blocked"); return; }

  // The callback URL is on THIS same origin, so postMessage from there works.
  window.addEventListener("message", async (ev) => {
    if (ev.origin !== location.origin) return;
    if (ev.data?.type !== "pcdash_code") return;
    if (ev.data.state !== APP.state) return;
    const cbRes = await fetch("/__pcdash/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: ev.data.code, redirectUri: APP.redirectUri }),
    });
    if (cbRes.ok) location.href = APP.returnPath || "/";
    else showError("Token exchange failed");
  });
});
</script>
</body>
</html>`;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}
