"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Fingerprint, Smartphone, Trash2, Plus } from "lucide-react";
import { startRegistration } from "@simplewebauthn/browser";
import { useToast } from "@/hooks/use-toast";

interface PasskeyInfo {
  id: string;
  name: string;
  createdAt: string;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpSetup, setTotpSetup] = useState<{ qrCode: string; secret: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [passkeyName, setPasskeyName] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        setTotpEnabled(data.methods.totp);
      }
      // Fetch passkeys list from auth store via a simple endpoint
      const pkRes = await fetch("/api/auth/passkey/register-options");
      if (pkRes.ok) {
        const opts = await pkRes.json();
        // We can infer existing passkeys from excludeCredentials
        // but better to add a dedicated list endpoint later
      }
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const registerPasskey = async () => {
    setLoading(true);
    try {
      const optionsRes = await fetch("/api/auth/passkey/register-options");
      const options = await optionsRes.json();
      const credential = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch("/api/auth/passkey/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credential,
          name: passkeyName || `Passkey ${new Date().toLocaleDateString()}`,
        }),
      });

      if (verifyRes.ok) {
        toast({ title: "Passkey registered", description: "You can now use it to sign in." });
        setPasskeyName("");
        fetchStatus();
      } else {
        const data = await verifyRes.json();
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } catch (err: any) {
      if (err.name !== "NotAllowedError") {
        toast({ title: "Error", description: "Failed to register passkey", variant: "destructive" });
      }
    } finally {
      setLoading(false);
    }
  };

  const setupTotp = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/totp/setup", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setTotpSetup(data);
      }
    } catch {
      toast({ title: "Error", description: "Failed to set up TOTP", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const enableTotp = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/totp/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: totpCode }),
      });

      if (res.ok) {
        toast({ title: "TOTP enabled", description: "Google Authenticator is now active." });
        setTotpSetup(null);
        setTotpCode("");
        setTotpEnabled(true);
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to enable TOTP", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const disableTotp = async () => {
    try {
      const res = await fetch("/api/auth/totp/enable", { method: "DELETE" });
      if (res.ok) {
        setTotpEnabled(false);
        toast({ title: "TOTP disabled" });
      }
    } catch {}
  };

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold text-text-primary">Settings</h1>

      {/* Passkeys */}
      <Card className="bg-surface border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-text-primary">
            <Fingerprint className="h-5 w-5" />
            Passkeys
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-text-secondary">
            Register a passkey for passwordless sign-in using biometrics or a security key.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Passkey name (optional)"
              value={passkeyName}
              onChange={(e) => setPasskeyName(e.target.value)}
              className="bg-elevated border-border text-text-primary"
            />
            <Button
              onClick={registerPasskey}
              disabled={loading}
              className="bg-accent hover:bg-accent-hover text-white shrink-0"
            >
              <Plus className="h-4 w-4 mr-1" />
              Register
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* TOTP */}
      <Card className="bg-surface border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-text-primary">
            <Smartphone className="h-5 w-5" />
            Google Authenticator (TOTP)
            {totpEnabled && (
              <Badge variant="secondary" className="bg-success/10 text-success ml-2">
                Enabled
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!totpEnabled && !totpSetup && (
            <>
              <p className="text-sm text-text-secondary">
                Add a time-based one-time password for an additional sign-in method.
              </p>
              <Button
                onClick={setupTotp}
                disabled={loading}
                className="bg-accent hover:bg-accent-hover text-white"
              >
                Set up TOTP
              </Button>
            </>
          )}

          {totpSetup && (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">
                Scan this QR code with Google Authenticator, then enter the 6-digit code to verify.
              </p>
              <div className="flex justify-center">
                <img
                  src={totpSetup.qrCode}
                  alt="TOTP QR Code"
                  className="w-48 h-48 rounded-lg"
                />
              </div>
              <p className="text-xs text-text-secondary text-center font-mono break-all">
                Manual key: {totpSetup.secret}
              </p>
              <div className="flex gap-2">
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="Enter 6-digit code"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                  className="bg-elevated border-border text-text-primary font-mono text-center"
                />
                <Button
                  onClick={enableTotp}
                  disabled={loading || totpCode.length !== 6}
                  className="bg-success hover:bg-success/90 text-white"
                >
                  Verify & Enable
                </Button>
              </div>
            </div>
          )}

          {totpEnabled && (
            <Button
              onClick={disableTotp}
              variant="ghost"
              className="text-danger hover:text-danger/80"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Disable TOTP
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
