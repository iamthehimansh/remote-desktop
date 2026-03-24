import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getPasskeys } from "@/lib/auth-store";
import { setAuthenticationChallenge } from "@/lib/challenge-store";
import { getWebAuthnConfig } from "@/lib/webauthn";

export async function GET(request: Request) {
  const { rpID } = getWebAuthnConfig(request);
  const passkeys = getPasskeys();

  if (passkeys.length === 0) {
    return NextResponse.json(
      { error: "No passkeys registered" },
      { status: 404 }
    );
  }

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: passkeys.map((p) => ({
      id: p.id,
      transports: p.transports as AuthenticatorTransport[] | undefined,
    })),
    userVerification: "preferred",
  });

  setAuthenticationChallenge("admin", options.challenge);

  return NextResponse.json(options);
}
