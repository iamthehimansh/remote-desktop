import { NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { getPasskeys, updatePasskeyCounter } from "@/lib/auth-store";
import { signToken, createSessionCookie } from "@/lib/auth";
import { getAuthenticationChallenge, deleteAuthenticationChallenge } from "@/lib/challenge-store";

const RP_ID = process.env.NODE_ENV === "production" ? "pc.himansh.in" : "localhost";
const ORIGIN = process.env.NODE_ENV === "production"
  ? "https://pc.himansh.in"
  : "http://localhost:3005";

export async function POST(request: Request) {
  const body = await request.json();
  const expectedChallenge = getAuthenticationChallenge("admin");

  if (!expectedChallenge) {
    return NextResponse.json(
      { error: "No authentication challenge found" },
      { status: 400 }
    );
  }

  const passkeys = getPasskeys();
  const passkey = passkeys.find((p) => p.id === body.id);

  if (!passkey) {
    return NextResponse.json(
      { error: "Passkey not found" },
      { status: 404 }
    );
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: passkey.id,
        publicKey: Buffer.from(passkey.publicKey, "base64url"),
        counter: passkey.counter,
        transports: passkey.transports as AuthenticatorTransport[] | undefined,
      },
    });

    if (!verification.verified) {
      return NextResponse.json({ error: "Verification failed" }, { status: 401 });
    }

    updatePasskeyCounter(passkey.id, verification.authenticationInfo.newCounter);
    deleteAuthenticationChallenge("admin");

    const token = signToken();
    const response = NextResponse.json({ success: true });
    response.headers.set("Set-Cookie", createSessionCookie(token));
    return response;
  } catch (error) {
    console.error("Passkey login error:", error);
    return NextResponse.json(
      { error: "Authentication failed" },
      { status: 500 }
    );
  }
}
