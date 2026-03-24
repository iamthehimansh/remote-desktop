"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface TerminalViewProps {
  shell: string;
}

export default function TerminalView({ shell }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const disposedRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    disposedRef.current = false;

    const term = new Terminal({
      theme: {
        background: "#09090b",
        foreground: "#fafafa",
        cursor: "#3b82f6",
        selectionBackground: "#3b82f640",
        black: "#09090b",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#fafafa",
      },
      fontFamily: "JetBrains Mono, Fira Code, monospace",
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "block",
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    termRef.current = term;

    term.open(container);
    setTimeout(() => {
      if (!disposedRef.current) try { fitAddon.fit(); } catch {}
    }, 100);

    // Terminal input handler (wired before WS connects so it's ready)
    term.onData((data) => {
      const socket = wsRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data }));
      }
    });

    // Resize observer
    const observer = new ResizeObserver(() => {
      if (disposedRef.current) return;
      try {
        fitAddon.fit();
        const socket = wsRef.current;
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      } catch {}
    });
    observer.observe(container);

    // Connect WebSocket (async to fetch token for prod)
    const connect = async () => {
      const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

      let tokenParam = "";
      if (!isLocalhost) {
        try {
          const res = await fetch("/api/auth/token");
          if (res.ok) {
            const data = await res.json();
            tokenParam = `&token=${encodeURIComponent(data.token)}`;
          }
        } catch {}
      }

      if (disposedRef.current) return;

      const url = isLocalhost
        ? `ws://localhost:3006?shell=${shell}`
        : `wss://${window.location.host}/ws/ssh?shell=${shell}${tokenParam}`;

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "output") {
            term.write(msg.data);
          } else if (msg.type === "exit") {
            term.write(`\r\n\x1b[33mProcess exited with code ${msg.code}\x1b[0m\r\n`);
          }
        } catch {}
      };

      ws.onclose = () => {
        if (!disposedRef.current) {
          term.write("\r\n\x1b[31mConnection closed\x1b[0m\r\n");
        }
      };

      ws.onerror = () => {
        if (!disposedRef.current) {
          term.write("\r\n\x1b[31mConnection error\x1b[0m\r\n");
        }
      };
    };

    connect();

    return () => {
      disposedRef.current = true;
      observer.disconnect();
      wsRef.current?.close();
      term.dispose();
      wsRef.current = null;
      termRef.current = null;
    };
  }, [shell]);

  return <div ref={containerRef} className="h-full w-full" style={{ minHeight: "200px" }} />;
}
