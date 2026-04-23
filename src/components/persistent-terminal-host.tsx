"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { usePersistentSessions } from "@/contexts/persistent-sessions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, X, Terminal as TerminalIcon, ChevronDown, Clock, Settings } from "lucide-react";

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
  const { terminalTabs, setTerminalTabs, activeTabId, setActiveTabId } = usePersistentSessions();

  // tabId -> { sessionId, ttlMs }
  const [sessionInfo, setSessionInfo] = useState<Record<string, { sessionId: string; ttlMs: number | "unlimited" }>>({});
  const wsRefForTab = useRef<Record<string, WebSocket | null>>({});

  const visible = pathname === "/dashboard/terminal";

  // Listen for session events from TerminalView
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.tabId) return;
      setSessionInfo((prev) => ({ ...prev, [detail.tabId]: { sessionId: detail.sessionId, ttlMs: detail.ttlMs } }));
    };
    window.addEventListener("terminal-session", handler);
    return () => window.removeEventListener("terminal-session", handler);
  }, []);

  const addTab = (shell: string) => {
    const label = SHELLS.find((s) => s.value === shell)?.label || shell;
    const id = String(Date.now());
    setTerminalTabs((prev) => [...prev, { id, shell, title: label }]);
    setActiveTabId(id);
  };

  const closeTab = (id: string) => {
    // Tell server to destroy the session too
    const info = sessionInfo[id];
    if (info?.sessionId) {
      const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
      const base = isLocalhost ? "http://localhost:3006" : `https://${window.location.host}/ws-api`;
      fetch(`${base}/sessions/${info.sessionId}`, { method: "DELETE" }).catch(() => {});
    }
    localStorage.removeItem(`terminal-session-${id}`);

    setTerminalTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) return prev;
      if (activeTabId === id) setActiveTabId(next[next.length - 1].id);
      return next;
    });
  };

  const updateTTL = (tabId: string, ttlMs: number | "unlimited") => {
    const info = sessionInfo[tabId];
    if (!info?.sessionId) return;
    // Send via WebSocket if possible (simpler since we already have it open)
    // Use custom event to ask the TerminalView to send the ttl message
    window.dispatchEvent(new CustomEvent("terminal-set-ttl", {
      detail: { tabId, ttlMs },
    }));
    setSessionInfo((prev) => ({ ...prev, [tabId]: { ...prev[tabId], ttlMs } }));
  };

  return (
    <div
      className="absolute inset-0 flex flex-col"
      style={{
        visibility: visible ? "visible" : "hidden",
        pointerEvents: visible ? "auto" : "none",
        zIndex: visible ? 10 : -1,
      }}
      // Block focus stealing when not visible
      {...(!visible && { inert: "" as any })}
    >
      {/* Tab bar */}
      <div className="flex items-center bg-surface border-b border-border px-2 h-9 shrink-0">
        {terminalTabs.map((tab) => {
          const info = sessionInfo[tab.id];
          return (
            <div
              key={tab.id}
              className={`flex items-center gap-1.5 px-3 h-full text-xs border-r border-border transition-colors cursor-pointer ${
                activeTabId === tab.id
                  ? "bg-background text-text-primary"
                  : "text-text-secondary hover:text-text-primary hover:bg-elevated/50"
              }`}
              onClick={() => setActiveTabId(tab.id)}
            >
              <TerminalIcon className="h-3 w-3" />
              <span>{tab.title}</span>
              {info?.ttlMs !== undefined && (
                <span className="ml-1 px-1.5 rounded bg-elevated text-[10px] font-mono" title={`TTL: ${formatTTL(info.ttlMs)}`}>
                  {formatTTL(info.ttlMs)}
                </span>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className="ml-0.5 p-0.5 hover:bg-elevated rounded"
                  >
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
                      {info?.ttlMs === opt.value && <span className="ml-auto text-success">✓</span>}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {terminalTabs.length > 1 && (
                <X
                  className="h-3 w-3 ml-1 hover:text-danger"
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                />
              )}
            </div>
          );
        })}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-full px-2 text-text-secondary hover:text-text-primary">
              <Plus className="h-3.5 w-3.5" />
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
      </div>

      {/* Terminal views — all mounted, only active one shown */}
      <div className="flex-1 relative bg-background">
        {terminalTabs.map((tab) => (
          <div
            key={tab.id}
            className="absolute inset-0"
            style={{ display: tab.id === activeTabId ? "block" : "none" }}
          >
            <TerminalView shell={tab.shell} tabId={tab.id} />
          </div>
        ))}
      </div>
    </div>
  );
}
