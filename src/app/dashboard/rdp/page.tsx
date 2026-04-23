"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Monitor, Power, Maximize2, Minimize2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import screenfull from "screenfull";

export default function RdpPage() {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [checking, setChecking] = useState(true);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = useCallback(() => {
    if (screenfull.isEnabled && wrapperRef.current) {
      screenfull.toggle(wrapperRef.current);
    }
  }, []);

  useEffect(() => {
    if (screenfull.isEnabled) {
      const handler = () => setIsFullscreen(screenfull.isFullscreen);
      screenfull.on("change", handler);
      return () => { screenfull.off("change", handler); };
    }
  }, []);

  useEffect(() => {
    fetch("/api/rdp/status")
      .then((r) => r.json())
      .then((d) => setRunning(d.running))
      .catch(() => {})
      .finally(() => setChecking(false));
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
        setRunning(true);
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

  const stop = async () => {
    setLoading(true);
    try {
      await fetch("/api/rdp/stop", { method: "POST" });
      setRunning(false);
      if (isFullscreen && screenfull.isEnabled) screenfull.exit();
      toast({ title: "Remote Desktop stopped" });
    } catch {
      toast({ title: "Failed to stop", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const guacUrl = typeof window !== "undefined"
    ? window.location.hostname === "localhost"
      ? "http://localhost:8080/guacamole/#/"
      : `${window.location.protocol}//${window.location.host}/guacamole/#/`
    : "";

  if (checking) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-text-secondary" />
      </div>
    );
  }

  if (!running) {
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

  return (
    <div ref={wrapperRef} className="flex flex-col h-full -m-6 bg-background">
      {/* Toolbar — auto-hides in fullscreen, shows on hover */}
      <div
        className={`flex items-center justify-between px-4 bg-surface border-b border-border shrink-0 transition-all ${
          isFullscreen ? "h-0 overflow-hidden hover:h-10 absolute top-0 left-0 right-0 z-50 opacity-0 hover:opacity-100" : "h-10"
        }`}
      >
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-success/10 text-success text-xs">
            Connected
          </Badge>
          <span className="text-xs text-text-secondary">Windows Desktop via RDP</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleFullscreen}
            className="text-text-secondary hover:text-text-primary"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={stop}
            disabled={loading}
            className="text-danger hover:text-danger/80"
          >
            <Power className="h-4 w-4 mr-1" />
            Stop
          </Button>
        </div>
      </div>

      {/* Guacamole iframe */}
      <iframe
        src={guacUrl}
        className="flex-1 w-full border-0"
        allow="clipboard-read *; clipboard-write *; microphone *; camera *; fullscreen *; display-capture *"
      />
    </div>
  );
}
