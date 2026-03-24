import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { getPasskeys } from "@/lib/auth-store";
import { setRegistrationChallenge } from "@/lib/challenge-store";
import { getWebAuthnConfig } from "@/lib/webauthn";

export async function GET(request: Request) {
  const { rpID, rpName } = getWebAuthnConfig(request);
  const existingPasskeys = getPasskeys();

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
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
