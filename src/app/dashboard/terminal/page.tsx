"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, X, Terminal as TerminalIcon, ChevronDown } from "lucide-react";

const TerminalView = dynamic(() => import("@/components/terminal-view"), { ssr: false });

interface TerminalTab {
  id: string;
  shell: string;
  title: string;
}

const SHELLS = [
  { value: "powershell", label: "PowerShell" },
  { value: "cmd", label: "CMD" },
  { value: "wsl", label: "WSL" },
];

export default function TerminalPage() {
  const [tabs, setTabs] = useState<TerminalTab[]>([
    { id: "1", shell: "powershell", title: "PowerShell" },
  ]);
  const [activeTab, setActiveTab] = useState("1");

  const addTab = (shell: string) => {
    const label = SHELLS.find((s) => s.value === shell)?.label || shell;
    const id = String(Date.now());
    setTabs((prev) => [...prev, { id, shell, title: label }]);
    setActiveTab(id);
  };

  const closeTab = (id: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) return prev; // Keep at least one tab
      if (activeTab === id) setActiveTab(next[next.length - 1].id);
      return next;
    });
  };

  return (
    <div className="h-full flex flex-col -m-6">
      {/* Tab bar */}
      <div className="flex items-center bg-surface border-b border-border px-2 h-9 shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 h-full text-xs border-r border-border transition-colors ${
              activeTab === tab.id
                ? "bg-background text-text-primary"
                : "text-text-secondary hover:text-text-primary hover:bg-elevated/50"
            }`}
          >
            <TerminalIcon className="h-3 w-3" />
            {tab.title}
            {tabs.length > 1 && (
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

      {/* Terminal views */}
      <div className="flex-1 relative">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`absolute inset-0 ${activeTab === tab.id ? "block" : "hidden"}`}
          >
            <TerminalView shell={tab.shell} />
          </div>
        ))}
      </div>
    </div>
  );
}
