"use client";

import { createContext, useContext, useState, ReactNode } from "react";

export interface TerminalTab {
  id: string;
  shell: string;
  title: string;
}

interface PersistentSessionsContextValue {
  terminalTabs: TerminalTab[];
  setTerminalTabs: React.Dispatch<React.SetStateAction<TerminalTab[]>>;
  activeTabId: string;
  setActiveTabId: (id: string) => void;

  // RDP
  rdpRunning: boolean;
  setRdpRunning: (running: boolean) => void;
  rdpFullscreen: boolean;
  setRdpFullscreen: (fs: boolean) => void;
}

const PersistentSessionsContext = createContext<PersistentSessionsContextValue | null>(null);

export function PersistentSessionsProvider({ children }: { children: ReactNode }) {
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([
    { id: "1", shell: "powershell", title: "PowerShell" },
  ]);
  const [activeTabId, setActiveTabId] = useState("1");
  const [rdpRunning, setRdpRunning] = useState(false);
  const [rdpFullscreen, setRdpFullscreen] = useState(false);

  return (
    <PersistentSessionsContext.Provider
      value={{
        terminalTabs, setTerminalTabs, activeTabId, setActiveTabId,
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
