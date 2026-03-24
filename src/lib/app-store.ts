import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";

export interface AppConfig {
  id: string;
  name: string;
  icon: string; // lucide icon name
  description: string;
  command: string; // command to start the app
  port: number;
  subdomain: string; // e.g. "code" -> code.himansh.in
  authType: "token-query" | "token-header" | "password-env" | "none";
  authParam?: string; // query param name for token, e.g. "token" for Jupyter
  envVars?: Record<string, string>; // extra env vars when starting
  healthPath?: string; // path to check if app is ready, e.g. "/"
  status: "stopped" | "starting" | "running";
  pid?: number;
  dnsRecordId?: string;
  url?: string;
  custom?: boolean; // user-created app
}

const DATA_PATH = resolve(process.cwd(), "data/apps.json");

const DEFAULT_APPS: AppConfig[] = [
  {
    id: "jupyter",
    name: "Jupyter Notebook",
    icon: "BookOpen",
    description: "Python notebooks with data science libraries",
    command: "C:\\Users\\pc\\AppData\\Roaming\\Python\\Python314\\Scripts\\jupyter-lab.exe --no-browser --ip=0.0.0.0 --port={port} --IdentityProvider.token={token} --ServerApp.allow_origin=*",
    port: 8888,
    subdomain: "jupyter",
    authType: "token-query",
    authParam: "token",
    healthPath: "/api",
    status: "stopped",
  },
  {
    id: "code-server",
    name: "VS Code Web",
    icon: "Code",
    description: "VS Code in the browser via code-server CLI",
    command: "code tunnel --accept-server-license-terms",
    port: 8443,
    subdomain: "code",
    authType: "none",
    healthPath: "/",
    status: "stopped",
  },
  {
    id: "ollama-webui",
    name: "Ollama Web UI",
    icon: "Bot",
    description: "Chat with local LLMs via Ollama",
    command: "C:\\Users\\pc\\AppData\\Local\\Programs\\Python\\Python312\\python.exe -m open_webui serve --port {port}",
    port: 3080,
    subdomain: "ai",
    authType: "none",
    healthPath: "/",
    status: "stopped",
  },
];

function ensureDir() {
  const dir = dirname(DATA_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function readApps(): AppConfig[] {
  ensureDir();
  if (!existsSync(DATA_PATH)) {
    writeFileSync(DATA_PATH, JSON.stringify(DEFAULT_APPS, null, 2));
    return DEFAULT_APPS;
  }
  try {
    return JSON.parse(readFileSync(DATA_PATH, "utf-8"));
  } catch {
    return DEFAULT_APPS;
  }
}

export function writeApps(apps: AppConfig[]): void {
  ensureDir();
  writeFileSync(DATA_PATH, JSON.stringify(apps, null, 2));
}

export function getApp(id: string): AppConfig | undefined {
  return readApps().find((a) => a.id === id);
}

export function updateApp(id: string, updates: Partial<AppConfig>): void {
  const apps = readApps();
  const idx = apps.findIndex((a) => a.id === id);
  if (idx !== -1) {
    apps[idx] = { ...apps[idx], ...updates };
    writeApps(apps);
  }
}

export function addApp(app: AppConfig): void {
  const apps = readApps();
  apps.push(app);
  writeApps(apps);
}

export function removeApp(id: string): void {
  const apps = readApps().filter((a) => a.id !== id);
  writeApps(apps);
}
