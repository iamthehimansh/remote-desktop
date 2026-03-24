import { resolve, normalize, sep } from "path";

export function getFileManagerRoot(): string {
  return normalize(process.env.FILE_MANAGER_ROOT || "C:\\Users\\pc");
}

export function safePath(requestedPath: string): string {
  const root = getFileManagerRoot();
  const resolved = resolve(root, requestedPath);
  const normalized = normalize(resolved);

  // Ensure the path is within the root directory
  if (!normalized.startsWith(root + sep) && normalized !== root) {
    throw new Error("Access denied: path outside root directory");
  }

  return normalized;
}
