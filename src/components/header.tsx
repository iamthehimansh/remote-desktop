"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { LogOut, Wifi } from "lucide-react";
import { formatUptime } from "@/lib/utils";

export function Header() {
  const router = useRouter();
  const [uptime, setUptime] = useState<number | null>(null);

  useEffect(() => {
    // Fetch uptime from system stats when available
    const fetchUptime = async () => {
      try {
        const res = await fetch("/api/system/stats");
        if (res.ok) {
          const data = await res.json();
          setUptime(data.os?.uptime);
        }
      } catch {
        // Stats API not ready yet
      }
    };

    fetchUptime();
    const interval = setInterval(fetchUptime, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  return (
    <header className="h-14 flex items-center justify-between px-6 border-b border-border bg-surface/50 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm text-text-secondary">
          pc.himansh.in
        </span>
        <div className="flex items-center gap-1.5">
          <Wifi className="h-3 w-3 text-success" />
          <span className="text-xs text-text-secondary">Connected</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {uptime !== null && (
          <span className="text-xs text-text-secondary font-mono">
            Uptime: {formatUptime(uptime)}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="text-text-secondary hover:text-danger"
        >
          <LogOut className="h-4 w-4 mr-1.5" />
          <span className="text-xs">Logout</span>
        </Button>
      </div>
    </header>
  );
}
