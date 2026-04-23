"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { usePersistentSessions } from "@/contexts/persistent-sessions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Plus, X, Terminal as TerminalIcon, ChevronDown, Clock, Settings, Loader2 } from "lucide-react";

const TerminalView = dynamic(() => import("@/components/terminal-view"), { ssr: false });

const SHELLS = [
  { value: "powershell", label: "PowerShell" },
  { value: "powershell-admin", label: "PowerShell (Admin)" },
  { value: "cmd", label: "CMD" },
  { value: "wsl", label: "WSL" },
];

const TTL_OPTIONS: Array<{ value: number | "unlimited"; label: string }> = [
  { value: 5 * 60 * 1000, label: "5 minutes" },
  { value: 15 * 60 * 1000, label: "15 minutes" },
  { value: 30 * 60 * 1000, label: "30 minutes (default)" },
  { value: 60 * 60 * 1000, label: "1 hour" },
  { value: 4 * 60 * 60 * 1000, label: "4 hours" },
  { value: 24 * 60 * 60 * 1000, label: "24 hours" },
  { value: "unlimited", label: "Unlimited (never kill)" },
];

function formatTTL(ttl: number | "unlimited" | undefined): string {
  if (ttl === "unlimited") return "∞";
  if (!ttl) return "—";
  const minutes = Math.round(ttl / 60000);
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

export function PersistentTerminalHost() {
  const pathname = usePathname();
  const {
    terminalTabs, setTerminalTabs, activeTabId, setActiveTabId,
    refreshSessions, sessionsLoaded,
  } = usePersistentSessions();
  const [creating, setCreating] = useState(false);

  const visible = pathname === "/dashboard/terminal";

  // Refresh list whenever user navigates to the terminal page
  // so other devices see sessions created elsewhere
  useEffect(() => {
    if (visible) refreshSessions();
  }, [visible, refreshSessions]);

  // Periodic refresh to pick up sessions from other devices / server TTL expirations
  useEffect(() => {
    const interval = setInterval(() => refreshSessions(), 10000);
    return () => clearInterval(interval);
  }, [refreshSessions]);

  const addTab = async (shell: string) => {
    setCreating(true);
    try {
      const label = SHELLS.find((s) => s.value === shell)?.label || shell;
      const res = await fetch("/api/terminal/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shell, title: label }),
      });
      if (res.ok) {
        const data = await res.json();
        const newTab = { id: data.id, shell: data.shell, title: data.title, ttlMs: data.ttlMs };
        setTerminalTabs((prev) => [...prev, newTab]);
        setActiveTabId(data.id);
      }
    } catch {}
    setCreating(false);
  };

  const closeTab = async (id: string) => {
    try {
      await fetch(`/api/terminal/sessions/${id}`, { method: "DELETE" });
    } catch {}
    setTerminalTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeTabId === id) setActiveTabId(next[next.length - 1]?.id || "");
      return next;
    });
  };

  const updateTTL = async (tabId: string, ttlMs: number | "unlimited") => {
    try {
      await fetch(`/api/terminal/sessions/${tabId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ttlMs }),
      });
    } catch {}
    setTerminalTabs((prev) => prev.map((t) => t.id === tabId ? { ...t, ttlMs } : t));
  };

  return (
    <div
      className="absolute inset-0 flex flex-col"
      style={{
        visibility: visible ? "visible" : "hidden",
        pointerEvents: visible ? "auto" : "none",
        zIndex: visible ? 10 : -1,
      }}
      {...(!visible && { inert: "" as any })}
    >
      {/* Tab bar */}
      <div className="flex items-center bg-surface border-b border-border px-2 h-9 shrink-0 overflow-x-auto">
        {terminalTabs.map((tab) => (
          <div
            key={tab.id}
            className={`flex items-center gap-1.5 px-3 h-full text-xs border-r border-border transition-colors cursor-pointer shrink-0 ${
              activeTabId === tab.id
                ? "bg-background text-text-primary"
                : "text-text-secondary hover:text-text-primary hover:bg-elevated/50"
            }`}
            onClick={() => setActiveTabId(tab.id)}
          >
            <TerminalIcon className="h-3 w-3" />
            <span>{tab.title}</span>
            {tab.ttlMs !== undefined && (
              <span className="ml-1 px-1.5 rounded bg-elevated text-[10px] font-mono" title={`Session TTL: ${formatTTL(tab.ttlMs)}`}>
                {formatTTL(tab.ttlMs)}
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button onClick={(e) => e.stopPropagation()} className="ml-0.5 p-0.5 hover:bg-elevated rounded">
                  <Settings className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="bg-surface border-border">
                <DropdownMenuLabel className="text-xs">Session TTL</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {TTL_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={String(opt.value)}
                    onClick={() => updateTTL(tab.id, opt.value)}
                    className="text-text-primary focus:bg-elevated text-xs"
                  >
                    <Clock className="h-3 w-3 mr-2" />
                    {opt.label}
                    {tab.ttlMs === opt.value && <span className="ml-auto text-success">✓</span>}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <X
              className="h-3 w-3 ml-1 hover:text-danger"
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
            />
          </div>
        ))}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" disabled={creating} className="h-full px-2 text-text-secondary hover:text-text-primary shrink-0">
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              <ChevronDown className="h-3 w-3 ml-0.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="bg-surface border-border">
            {SHELLS.map((shell) => (
              <DropdownMenuItem
                key={shell.value}
                onClick={() => addTab(shell.value)}
                className="text-text-primary focus:bg-elevated"
              >
                {shell.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {sessionsLoaded && terminalTabs.length === 0 && (
          <span className="ml-2 text-xs text-text-secondary">No sessions. Click + to start one.</span>
        )}
      </div>

      {/* Terminal views */}
      <div className="flex-1 relative bg-background">
        {terminalTabs.map((tab) => (
          <div
            key={tab.id}
            className="absolute inset-0"
            style={{ display: tab.id === activeTabId ? "block" : "none" }}
          >
            <TerminalView shell={tab.shell} tabId={tab.id} sessionId={tab.id} />
          </div>
        ))}
      </div>
    </div>
  );
}
