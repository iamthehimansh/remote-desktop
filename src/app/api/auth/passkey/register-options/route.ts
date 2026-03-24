import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { getPasskeys } from "@/lib/auth-store";
import { setRegistrationChallenge } from "@/lib/challenge-store";

const RP_NAME = "PC Dashboard";
const RP_ID = process.env.NODE_ENV === "production" ? "pc.himansh.in" : "localhost";

export async function GET() {
  const existingPasskeys = getPasskeys();

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: "admin",
    userDisplayName: "Admin",
    attestationType: "none",
    excludeCredentials: existingPasskeys.map((p) => ({
      id: p.id,
      transports: p.transports as AuthenticatorTransport[] | undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  setRegistrationChallenge("admin", options.challenge);

  return NextResponse.json(options);
}
