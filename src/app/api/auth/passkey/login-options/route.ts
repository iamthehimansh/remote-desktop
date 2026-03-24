import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getPasskeys } from "@/lib/auth-store";
import { setAuthenticationChallenge } from "@/lib/challenge-store";

const RP_ID = process.env.NODE_ENV === "production" ? "pc.himansh.in" : "localhost";

export async function GET() {
  const passkeys = getPasskeys();

  if (passkeys.length === 0) {
    return NextResponse.json(
      { error: "No passkeys registered" },
      { status: 404 }
    );
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: passkeys.map((p) => ({
      id: p.id,
      transports: p.transports as AuthenticatorTransport[] | undefined,
    })),
    userVerification: "preferred",
  });

  setAuthenticationChallenge("admin", options.challenge);

  return NextResponse.json(options);
}
