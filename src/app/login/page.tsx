"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Lock, Fingerprint, Smartphone, Terminal } from "lucide-react";
import { startAuthentication } from "@simplewebauthn/browser";

interface AuthMethods {
  password: boolean;
  passkey: boolean;
  totp: boolean;
}

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const [methods, setMethods] = useState<AuthMethods>({
    password: true,
    passkey: false,
    totp: false,
  });

  useEffect(() => {
    fetch("/api/auth/methods")
      .then((r) => r.json())
      .then(setMethods)
      .catch(() => {});
  }, []);

  const showError = (msg: string) => {
    setError(msg);
    setShake(true);
    setTimeout(() => setShake(false), 500);
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push("/dashboard");
      } else {
        const data = await res.json();
        showError(data.error || "Login failed");
      }
    } catch {
      showError("Connection error");
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setLoading(true);
    setError("");

    try {
      const optionsRes = await fetch("/api/auth/passkey/login-options");
      if (!optionsRes.ok) {
        showError("No passkeys registered");
        setLoading(false);
        return;
      }

      const options = await optionsRes.json();
      const credential = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch("/api/auth/passkey/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credential),
      });

      if (verifyRes.ok) {
        router.push("/dashboard");
      } else {
        const data = await verifyRes.json();
        showError(data.error || "Passkey login failed");
      }
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        showError("Passkey authentication was cancelled");
      } else {
        showError("Passkey login failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleTotpLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/totp/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: totpCode }),
      });

      if (res.ok) {
        router.push("/dashboard");
      } else {
        const data = await res.json();
        showError(data.error || "Invalid code");
      }
    } catch {
      showError("Connection error");
    } finally {
      setLoading(false);
    }
  };

  const availableTabs = [
    { id: "password", label: "Password", icon: Lock, available: methods.password },
    { id: "passkey", label: "Passkey", icon: Fingerprint, available: methods.passkey },
    { id: "totp", label: "TOTP", icon: Smartphone, available: methods.totp },
  ].filter((t) => t.available);

  const defaultTab = availableTabs[0]?.id || "password";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      {/* Grid background */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <motion.div animate={shake ? { x: [-4, 4, -4, 4, 0] } : {}} transition={{ duration: 0.4 }}>
          <Card className="w-[400px] bg-surface/80 backdrop-blur-xl border-border">
            <CardHeader className="text-center pb-2">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Terminal className="h-6 w-6 text-accent" />
                <CardTitle className="text-xl font-mono text-text-primary">
                  PC Dashboard
                </CardTitle>
              </div>
              <p className="text-sm text-text-secondary">pc.himansh.in</p>
            </CardHeader>

            <CardContent>
              {error && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-danger text-sm text-center mb-4"
                >
                  {error}
                </motion.p>
              )}

              <Tabs defaultValue={defaultTab} className="w-full">
                {availableTabs.length > 1 && (
                  <TabsList className="grid w-full bg-elevated" style={{ gridTemplateColumns: `repeat(${availableTabs.length}, 1fr)` }}>
                    {availableTabs.map((tab) => (
                      <TabsTrigger
                        key={tab.id}
                        value={tab.id}
                        className="flex items-center gap-1.5 text-xs data-[state=active]:bg-surface"
                      >
                        <tab.icon className="h-3.5 w-3.5" />
                        {tab.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                )}

                <TabsContent value="password" className="mt-4">
                  <form onSubmit={handlePasswordLogin} className="space-y-4">
                    <Input
                      type="password"
                      placeholder="Enter password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="bg-elevated border-border text-text-primary placeholder:text-text-secondary"
                      autoFocus
                    />
                    <Button
                      type="submit"
                      disabled={loading || !password}
                      className="w-full bg-accent hover:bg-accent-hover text-white"
                    >
                      {loading ? "Signing in..." : "Sign in"}
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="passkey" className="mt-4">
                  <div className="space-y-4">
                    <p className="text-sm text-text-secondary text-center">
                      Use your registered passkey to sign in
                    </p>
                    <Button
                      onClick={handlePasskeyLogin}
                      disabled={loading}
                      className="w-full bg-accent hover:bg-accent-hover text-white"
                    >
                      <Fingerprint className="h-4 w-4 mr-2" />
                      {loading ? "Waiting for passkey..." : "Sign in with Passkey"}
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="totp" className="mt-4">
                  <form onSubmit={handleTotpLogin} className="space-y-4">
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      placeholder="6-digit code"
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                      className="bg-elevated border-border text-text-primary text-center text-2xl tracking-[0.5em] font-mono placeholder:text-text-secondary placeholder:text-base placeholder:tracking-normal"
                      autoFocus
                    />
                    <Button
                      type="submit"
                      disabled={loading || totpCode.length !== 6}
                      className="w-full bg-accent hover:bg-accent-hover text-white"
                    >
                      {loading ? "Verifying..." : "Verify Code"}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>
    </div>
  );
}
