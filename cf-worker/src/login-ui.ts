// Inline HTML login page served on the app subdomain.
// Three independent auth methods: Password / Passkey / TOTP (tabs).

interface Options {
  appId: string;
  appTitle: string;
  dashboardUrl: string;
  redirectUri: string;
  returnPath: string;
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
  .sub{text-align:center;color:#a1a1aa;font-size:13px;margin-bottom:8px}
  .app{text-align:center;margin:10px 0 20px;font-size:14px}
  .app b{color:#3b82f6}
  .err{color:#ef4444;text-align:center;font-size:13px;min-height:18px;margin-bottom:8px}
  .loading{text-align:center;color:#a1a1aa;font-size:12px;padding:16px}
  .tabs{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:4px;background:#27272a;border-radius:8px;padding:3px;margin-bottom:14px}
  .tab{padding:6px 10px;text-align:center;color:#a1a1aa;font-size:12px;cursor:pointer;border-radius:6px;display:flex;align-items:center;justify-content:center;gap:5px;border:none;background:transparent;font-family:inherit}
  .tab.active{background:#18181b;color:#fafafa}
  .tab svg{width:12px;height:12px}
  input{width:100%;padding:10px 12px;border-radius:6px;background:#27272a;border:1px solid #3f3f46;
    color:#fafafa;font-size:14px;font-family:inherit;margin-bottom:10px}
  input:focus{outline:none;border-color:#3b82f6}
  input.totp{font-family:"JetBrains Mono",monospace;text-align:center;font-size:20px;letter-spacing:8px}
  button.primary{width:100%;padding:10px;border-radius:6px;background:#3b82f6;color:#fff;border:none;
    font-size:14px;font-weight:500;cursor:pointer;font-family:inherit}
  button.primary:hover{background:#2563eb}
  button.primary:disabled{opacity:.5;cursor:not-allowed}
  .pane{display:none}
  .pane.active{display:block}
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
  <div class="sub">pc.himansh.in</div>
  <div class="app">Sign in to open <b>${escape(opts.appTitle)}</b></div>

  <div id="sso" class="loading">Checking session…</div>

  <div id="form-wrap" class="hidden">
    <div class="err" id="err"></div>

    <div class="tabs" id="tabs">
      <button class="tab active" data-pane="password" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
        Password
      </button>
      ${opts.passkeyEnabled ? `
      <button class="tab" data-pane="passkey" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 7V5a5 5 0 00-10 0"/><circle cx="12" cy="14" r="3"/></svg>
        Passkey
      </button>` : ``}
      ${opts.totpEnabled ? `
      <button class="tab" data-pane="totp" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/></svg>
        TOTP
      </button>` : ``}
    </div>

    <form class="pane active" id="pane-password" data-pane="password" autocomplete="off">
      <input type="password" id="pass" placeholder="Dashboard password" required autocomplete="current-password">
      <button type="submit" class="primary" id="submit-pw">Sign in</button>
    </form>

    ${opts.passkeyEnabled ? `
    <div class="pane" id="pane-passkey" data-pane="passkey">
      <p style="color:#a1a1aa;font-size:13px;margin:0 0 12px">Use your registered passkey.</p>
      <button type="button" class="primary" id="pkbtn">Sign in with Passkey</button>
    </div>` : ``}

    ${opts.totpEnabled ? `
    <form class="pane" id="pane-totp" data-pane="totp" autocomplete="off">
      <input type="text" id="totp" class="totp" placeholder="••••••" maxlength="6" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code">
      <button type="submit" class="primary" id="submit-totp">Verify</button>
    </form>` : ``}
  </div>
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
const formWrap = document.getElementById("form-wrap");
const errEl = document.getElementById("err");
const cardEl = document.getElementById("card");

function showForm() { ssoEl.classList.add("hidden"); formWrap.classList.remove("hidden"); }
function showError(msg) {
  errEl.textContent = msg;
  cardEl.classList.remove("shake"); void cardEl.offsetWidth; cardEl.classList.add("shake");
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.getAttribute("data-pane");
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("active", p.getAttribute("data-pane") === target));
    errEl.textContent = "";
  });
});

async function exchangeCode(code) {
  const res = await fetch("/__pcdash/callback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, redirectUri: APP.redirectUri }),
  });
  if (!res.ok) throw new Error("Token exchange failed");
  location.href = APP.returnPath || "/";
}

async function trySilentSSO() {
  const url = new URL(APP.dashboardUrl + "/api/oauth/authorize");
  url.searchParams.set("client_id", APP.appId);
  url.searchParams.set("redirect_uri", APP.redirectUri);
  url.searchParams.set("state", APP.state);
  url.searchParams.set("prompt", "silent");
  window.location.href = url.toString();
}

const params = new URLSearchParams(location.search);
if (params.has("error")) {
  showForm();
  const e = params.get("error");
  if (e && e !== "login_required") showError("Sign in issue: " + e);
} else {
  trySilentSSO();
}

// Password
document.getElementById("pane-password")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  errEl.textContent = "";
  const btn = document.getElementById("submit-pw");
  btn.disabled = true;
  try {
    const res = await fetch(APP.dashboardUrl + "/api/oauth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: document.getElementById("pass").value, clientId: APP.appId, redirectUri: APP.redirectUri }),
    });
    const data = await res.json();
    if (!res.ok) { showError(data.error || "Sign in failed"); return; }
    await exchangeCode(data.code);
  } catch (err) { showError("Network error"); }
  finally { btn.disabled = false; }
});

// TOTP
document.getElementById("pane-totp")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  errEl.textContent = "";
  const btn = document.getElementById("submit-totp");
  btn.disabled = true;
  try {
    const res = await fetch(APP.dashboardUrl + "/api/oauth/totp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ totp: document.getElementById("totp").value, clientId: APP.appId, redirectUri: APP.redirectUri }),
    });
    const data = await res.json();
    if (!res.ok) { showError(data.error || "Invalid code"); return; }
    await exchangeCode(data.code);
  } catch (err) { showError("Network error"); }
  finally { btn.disabled = false; }
});

// Passkey via popup (WebAuthn must run on pc.himansh.in origin)
document.getElementById("pkbtn")?.addEventListener("click", () => {
  const url = new URL(APP.dashboardUrl + "/api/oauth/authorize");
  url.searchParams.set("client_id", APP.appId);
  url.searchParams.set("redirect_uri", APP.redirectUri);
  url.searchParams.set("state", APP.state);
  const popup = window.open(url.toString(), "pcdash_pk", "width=440,height=620,popup=yes");
  if (!popup) { showError("Popup blocked"); return; }
  window.addEventListener("message", async (ev) => {
    if (ev.origin !== location.origin) return;
    if (ev.data?.type !== "pcdash_code") return;
    if (ev.data.state !== APP.state) return;
    if (ev.data.error) { showError("Passkey: " + ev.data.error); return; }
    try { await exchangeCode(ev.data.code); } catch (e) { showError("Sign in failed"); }
  });
});
</script>
</body></html>`;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}
