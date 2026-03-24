"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Fingerprint, Smartphone, Trash2, Plus, Key, Monitor, Clock, Lock } from "lucide-react";
import { startRegistration } from "@simplewebauthn/browser";
import { useToast } from "@/hooks/use-toast";

interface PasskeyInfo {
  id: string;
  name: string;
  createdAt: string;
  transports?: string[];
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpSetup, setTotpSetup] = useState<{ qrCode: string; secret: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [passkeyName, setPasskeyName] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const [meRes, pkRes] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/auth/passkey/list"),
      ]);

      if (meRes.ok) {
        const data = await meRes.json();
        setTotpEnabled(data.methods.totp);
      }

      if (pkRes.ok) {
        const data = await pkRes.json();
        setPasskeys(data.passkeys);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

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

  const deletePasskey = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch("/api/auth/passkey/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (res.ok) {
        toast({ title: "Passkey removed" });
        fetchStatus();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to remove passkey", variant: "destructive" });
    } finally {
      setDeletingId(null);
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

  const changePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast({ title: "Error", description: "Passwords don't match", variant: "destructive" });
      return;
    }
    setChangingPassword(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (res.ok) {
        toast({ title: "Password changed", description: "Use the new password next time you log in." });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to change password", variant: "destructive" });
    } finally {
      setChangingPassword(false);
    }
  };

  const getTransportIcon = (transports?: string[]) => {
    if (transports?.includes("internal")) return <Fingerprint className="h-4 w-4 text-accent" />;
    if (transports?.includes("usb")) return <Key className="h-4 w-4 text-warning" />;
    if (transports?.includes("hybrid")) return <Monitor className="h-4 w-4 text-success" />;
    return <Key className="h-4 w-4 text-text-secondary" />;
  };

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold text-text-primary">Settings</h1>

      {/* Change Password */}
      <Card className="bg-surface border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-text-primary">
            <Lock className="h-5 w-5" />
            Change Password
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Current Password</label>
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="bg-elevated border-border text-text-primary"
            />
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1 block">New Password</label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="bg-elevated border-border text-text-primary"
            />
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Confirm New Password</label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="bg-elevated border-border text-text-primary"
            />
          </div>
          <Button
            onClick={changePassword}
            disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
            className="bg-accent hover:bg-accent-hover text-white"
          >
            {changingPassword ? "Changing..." : "Change Password"}
          </Button>
        </CardContent>
      </Card>

      {/* Passkeys */}
      <Card className="bg-surface border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-text-primary">
            <Fingerprint className="h-5 w-5" />
            Passkeys
            {passkeys.length > 0 && (
              <Badge variant="secondary" className="bg-accent/10 text-accent ml-2">
                {passkeys.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Registered passkeys list */}
          {passkeys.length > 0 && (
            <div className="space-y-2">
              {passkeys.map((pk) => (
                <div
                  key={pk.id}
                  className="flex items-center justify-between p-3 bg-elevated rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    {getTransportIcon(pk.transports)}
                    <div>
                      <p className="text-sm text-text-primary font-medium">{pk.name}</p>
                      <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <Clock className="h-3 w-3" />
                        {new Date(pk.createdAt).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                        {pk.transports && (
                          <span className="ml-1.5 text-text-secondary/60">
                            {pk.transports.join(", ")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deletePasskey(pk.id)}
                    disabled={deletingId === pk.id}
                    className="text-danger hover:text-danger/80 hover:bg-danger/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {passkeys.length > 0 && <Separator className="bg-border" />}

          {/* Register new passkey */}
          <p className="text-sm text-text-secondary">
            Register a passkey for passwordless sign-in using biometrics or a security key.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Passkey name (e.g. MacBook, iPhone)"
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
