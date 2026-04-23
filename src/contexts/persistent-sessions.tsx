"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

export interface TerminalTab {
  id: string;      // server sessionId
  shell: string;
  title: string;
  ttlMs?: number | "unlimited";
}

interface PersistentSessionsContextValue {
  terminalTabs: TerminalTab[];
  setTerminalTabs: React.Dispatch<React.SetStateAction<TerminalTab[]>>;
  activeTabId: string;
  setActiveTabId: (id: string) => void;
  refreshSessions: () => Promise<void>;
  sessionsLoaded: boolean;

  // RDP
  rdpRunning: boolean;
  setRdpRunning: (running: boolean) => void;
  rdpFullscreen: boolean;
  setRdpFullscreen: (fs: boolean) => void;
}

const PersistentSessionsContext = createContext<PersistentSessionsContextValue | null>(null);

export function PersistentSessionsProvider({ children }: { children: ReactNode }) {
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState("");
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [rdpRunning, setRdpRunning] = useState(false);
  const [rdpFullscreen, setRdpFullscreen] = useState(false);

  const refreshSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/terminal/sessions", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const tabs: TerminalTab[] = (data.sessions || []).map((s: any) => ({
          id: s.id,
          shell: s.shell,
          title: s.title || s.shell,
          ttlMs: s.ttlMs,
        }));
        setTerminalTabs(tabs);
        setActiveTabId((prev) => (tabs.some((t) => t.id === prev) ? prev : tabs[0]?.id || ""));
      }
    } catch {}
    setSessionsLoaded(true);
  }, []);

  // Load server sessions on mount — same sessions seen from every device
  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  return (
    <PersistentSessionsContext.Provider
      value={{
        terminalTabs, setTerminalTabs, activeTabId, setActiveTabId,
        refreshSessions, sessionsLoaded,
        rdpRunning, setRdpRunning, rdpFullscreen, setRdpFullscreen,
      }}
    >
      {children}
    </PersistentSessionsContext.Provider>
  );
}

export function usePersistentSessions() {
  const ctx = useContext(PersistentSessionsContext);
  if (!ctx) throw new Error("usePersistentSessions must be used within PersistentSessionsProvider");
  return ctx;
}
