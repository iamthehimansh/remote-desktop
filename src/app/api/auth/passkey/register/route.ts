import { NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { addPasskey } from "@/lib/auth-store";
import { getRegistrationChallenge, deleteRegistrationChallenge } from "@/lib/challenge-store";
import { getWebAuthnConfig } from "@/lib/webauthn";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { rpID, origin } = getWebAuthnConfig(request);
  const body = await request.json();
  const expectedChallenge = getRegistrationChallenge("admin");

  if (!expectedChallenge) {
    return NextResponse.json(
      { error: "No registration challenge found. Start registration again." },
      { status: 400 }
    );
  }

  try {
    const verification = await verifyRegistrationResponse({
      response: body.credential,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: "Verification failed" }, { status: 400 });
    }

    const { credential } = verification.registrationInfo;

    addPasskey({
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: body.credential.response.transports,
      createdAt: new Date().toISOString(),
      name: body.name || `Passkey ${Date.now()}`,
    });

    deleteRegistrationChallenge("admin");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Passkey registration error:", error);
    return NextResponse.json(
      { error: "Registration failed" },
      { status: 500 }
    );
  }
}
