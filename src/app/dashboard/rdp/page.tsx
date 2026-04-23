"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Monitor, Power, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePersistentSessions } from "@/contexts/persistent-sessions";

export default function RdpPage() {
  const { toast } = useToast();
  const { rdpRunning, setRdpRunning } = usePersistentSessions();
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch("/api/rdp/status")
      .then((r) => r.json())
      .then((d) => setRdpRunning(!!d.running))
      .catch(() => {})
      .finally(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async () => {
    setLoading(true);
    setLoadingText("Starting containers...");
    try {
      const res = await fetch("/api/rdp/start", { method: "POST" });
      const data = await res.json();
      if (data.status === "running" || data.status === "starting") {
        setLoadingText("Waiting for Guacamole...");
        await new Promise((r) => setTimeout(r, 2000));
        setRdpRunning(true);
        toast({ title: "Remote Desktop started" });
      } else {
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to start", variant: "destructive" });
    } finally {
      setLoading(false);
      setLoadingText("");
    }
  };

  if (checking) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-text-secondary" />
      </div>
    );
  }

  if (rdpRunning) {
    // Toolbar + iframe are rendered by PersistentRdpHost in the layout
    return <div className="h-full" />;
  }

  return (
    <div className="flex items-center justify-center h-full">
      <Card className="bg-surface border-border w-96">
        <CardContent className="p-8 text-center space-y-4">
          <Monitor className="h-16 w-16 text-text-secondary mx-auto" />
          <h2 className="text-xl text-text-primary font-semibold">Remote Desktop</h2>
          <p className="text-sm text-text-secondary">
            Start Apache Guacamole to access your Windows desktop in the browser.
          </p>
          <Button
            onClick={start}
            disabled={loading}
            className="bg-accent hover:bg-accent-hover text-white w-full"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {loadingText}
              </>
            ) : (
              <>
                <Power className="h-4 w-4 mr-2" />
                Start Remote Desktop
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
