import { resolve, normalize } from "path";

export function getFileManagerRoot(): string {
  // Default starting directory — but we allow navigating anywhere
  return normalize(process.env.FILE_MANAGER_ROOT || "C:\\Users\\pc");
}

export function safePath(requestedPath: string): string {
  // Allow full access to all drives — no root restriction
  const normalized = normalize(resolve(requestedPath));
  return normalized;
}

// Get all available drive letters on Windows
export async function getDrives(): Promise<string[]> {
  if (process.platform !== "win32") return ["/"];

  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  try {
    const { stdout } = await execAsync("wmic logicaldisk get name");
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[A-Z]:$/.test(l))
      .map((l) => l + "\\");
  } catch {
    return ["C:\\"];
  }
}
