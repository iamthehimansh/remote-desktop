import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { Toaster } from "@/components/ui/toaster";
import { PersistentSessionsProvider } from "@/contexts/persistent-sessions";
import { PersistentTerminalHost } from "@/components/persistent-terminal-host";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PersistentSessionsProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-auto relative">
            <div className="p-6 h-full">{children}</div>
            {/* Persistent terminals — always mounted, visibility toggled by route */}
            <PersistentTerminalHost />
          </main>
        </div>
        <Toaster />
      </div>
    </PersistentSessionsProvider>
  );
}
