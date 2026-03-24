import { hash } from "bcryptjs";
import { randomBytes } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(import.meta.dir, "../.env.local");

async function main() {
  process.stdout.write("Enter dashboard password: ");
  const password = await new Promise<string>((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
      if (data.includes("\n")) {
        process.stdin.pause();
        resolve(data.trim());
      }
    });
    process.stdin.resume();
  });

  if (!password || password.length < 4) {
    console.error("Password must be at least 4 characters.");
    process.exit(1);
  }

  const passwordHash = await hash(password, 12);
  const jwtSecret = randomBytes(32).toString("hex");

  let envContent = "";
  try {
    envContent = readFileSync(envPath, "utf-8");
  } catch {
    // File doesn't exist yet
  }

  const setEnvVar = (content: string, key: string, value: string): string => {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(content)) {
      return content.replace(regex, `${key}=${value}`);
    }
    return content.trimEnd() + `\n${key}=${value}`;
  };

  // Escape $ in bcrypt hash so Next.js doesn't interpret them as variable references
  const escapedHash = passwordHash.replace(/\$/g, "\\$");
  envContent = setEnvVar(envContent, "DASHBOARD_PASSWORD_HASH", escapedHash);
  envContent = setEnvVar(envContent, "JWT_SECRET", jwtSecret);

  writeFileSync(envPath, envContent + "\n");

  console.log("\nPassword hash and JWT secret written to .env.local");
  console.log(`  DASHBOARD_PASSWORD_HASH=${passwordHash}`);
  console.log(`  JWT_SECRET=${jwtSecret.slice(0, 8)}...`);
}

main().catch(console.error);
