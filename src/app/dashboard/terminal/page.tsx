"use client";

// Terminal UI is rendered by PersistentTerminalHost in the layout so sessions
// stay alive across navigation. This page just reserves the route.
export default function TerminalPage() {
  return <div className="h-full" />;
}
