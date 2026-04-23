"use client";

import { usePathname } from "next/navigation";
import { usePersistentSessions } from "@/contexts/persistent-sessions";
import { useEffect, useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Maximize2, Minimize2, Power, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import screenfull from "screenfull";

// Mounts the Guacamole iframe + toolbar once; stays alive across navigation.
// Hidden (visibility + pointer-events + inert + tabIndex=-1) when off /dashboard/rdp
// so it can NEVER steal keyboard focus.
export function PersistentRdpHost() {
  const pathname = usePathname();
  const { toast } = useToast();
  const { rdpRunning, setRdpRunning, rdpFullscreen, setRdpFullscreen } = usePersistentSessions();
  const [guacUrl, setGuacUrl] = useState("");
  const [stopping, setStopping] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/rdp/status")
      .then((r) => r.json())
      .then((d) => setRdpRunning(!!d.running))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = window.location.hostname === "localhost"
      ? "http://localhost:8080/guacamole/#/"
      : `${window.location.protocol}//${window.location.host}/guacamole/#/`;
    setGuacUrl(url);
  }, []);

  useEffect(() => {
    if (screenfull.isEnabled) {
      const handler = () => setRdpFullscreen(screenfull.isFullscreen);
      screenfull.on("change", handler);
      return () => { screenfull.off("change", handler); };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (screenfull.isEnabled && containerRef.current) {
      screenfull.toggle(containerRef.current);
    }
  }, []);

  const stop = async () => {
    setStopping(true);
    try {
      await fetch("/api/rdp/stop", { method: "POST" });
      setRdpRunning(false);
      if (rdpFullscreen && screenfull.isEnabled) screenfull.exit();
      toast({ title: "Remote Desktop stopped" });
    } catch {
      toast({ title: "Failed to stop", variant: "destructive" });
    } finally {
      setStopping(false);
    }
  };

  if (!rdpRunning || !guacUrl) return null;

  const visible = pathname === "/dashboard/rdp";

  return (
    <div
      ref={containerRef}
      className={`flex flex-col bg-background ${rdpFullscreen && visible ? "fixed inset-0" : "absolute inset-0"}`}
      style={{
        visibility: visible ? "visible" : "hidden",
        pointerEvents: visible ? "auto" : "none",
        zIndex: visible ? (rdpFullscreen ? 9999 : 5) : -1,
      }}
      {...(!visible && { inert: "" as any })}
      aria-hidden={!visible}
    >
      {/* Toolbar — hidden in fullscreen, shown on hover */}
      <div
        className={`flex items-center justify-between px-4 bg-surface border-b border-border shrink-0 transition-all ${
          rdpFullscreen ? "h-0 overflow-hidden hover:h-10 absolute top-0 left-0 right-0 z-50 opacity-0 hover:opacity-100" : "h-10"
        }`}
      >
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-success/10 text-success text-xs">Connected</Badge>
          <span className="text-xs text-text-secondary">Windows Desktop — running in background</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="sm"
            onClick={toggleFullscreen}
            className="text-text-secondary hover:text-text-primary"
          >
            {rdpFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost" size="sm"
            onClick={stop}
            disabled={stopping}
            className="text-danger hover:text-danger/80"
          >
            {stopping ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Power className="h-4 w-4 mr-1" />}
            Stop
          </Button>
        </div>
      </div>

      {/* Guacamole iframe — always mounted once running */}
      <iframe
        src={guacUrl}
        className="flex-1 w-full border-0"
        allow="clipboard-read *; clipboard-write *; microphone *; camera *; fullscreen *; display-capture *"
        tabIndex={visible ? 0 : -1}
      />
    </div>
  );
}
