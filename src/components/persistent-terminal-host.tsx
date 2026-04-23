"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { usePersistentSessions } from "@/contexts/persistent-sessions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, X, Terminal as TerminalIcon, ChevronDown } from "lucide-react";

const TerminalView = dynamic(() => import("@/components/terminal-view"), { ssr: false });

const SHELLS = [
  { value: "powershell", label: "PowerShell" },
  { value: "powershell-admin", label: "PowerShell (Admin)" },
  { value: "cmd", label: "CMD" },
  { value: "wsl", label: "WSL" },
];

// Always-mounted terminal container.
// Visible only on /dashboard/terminal but xterm + WebSocket + PTY stay alive across nav.
export function PersistentTerminalHost() {
  const pathname = usePathname();
  const { terminalTabs, setTerminalTabs, activeTabId, setActiveTabId } = usePersistentSessions();

  const visible = pathname === "/dashboard/terminal";

  const addTab = (shell: string) => {
    const label = SHELLS.find((s) => s.value === shell)?.label || shell;
    const id = String(Date.now());
    setTerminalTabs((prev) => [...prev, { id, shell, title: label }]);
    setActiveTabId(id);
  };

  const closeTab = (id: string) => {
    setTerminalTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) return prev;
      if (activeTabId === id) setActiveTabId(next[next.length - 1].id);
      return next;
    });
  };

  return (
    <div
      className="absolute inset-0 flex flex-col"
      style={{
        visibility: visible ? "visible" : "hidden",
        pointerEvents: visible ? "auto" : "none",
        zIndex: visible ? 10 : -1,
      }}
    >
      {/* Tab bar */}
      <div className="flex items-center bg-surface border-b border-border px-2 h-9 shrink-0">
        {terminalTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTabId(tab.id)}
            className={`flex items-center gap-1.5 px-3 h-full text-xs border-r border-border transition-colors ${
              activeTabId === tab.id
                ? "bg-background text-text-primary"
                : "text-text-secondary hover:text-text-primary hover:bg-elevated/50"
            }`}
          >
            <TerminalIcon className="h-3 w-3" />
            {tab.title}
            {terminalTabs.length > 1 && (
              <X
                className="h-3 w-3 ml-1 hover:text-danger"
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              />
            )}
          </button>
        ))}

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
