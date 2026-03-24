// Extract rpID and origin from the request for WebAuthn
export function getWebAuthnConfig(request: Request) {
  const origin = request.headers.get("origin") || "";
  const host = request.headers.get("host") || "localhost";

  // rpID is the domain without port
  const rpID = host.split(":")[0];

  return {
    rpID,
    rpName: "PC Dashboard",
    origin: origin || `https://${host}`,
  };
}
