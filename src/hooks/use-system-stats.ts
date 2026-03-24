"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface SystemStats {
  cpu: { model: string; cores: number; threads: number; speed: number; usage: number; temperature: number | null };
  memory: { total: number; used: number; free: number; usage: number };
  gpus: Array<{ model: string; vendor: string; usage: number; temperature: number | null; vramTotal: number; vramUsed: number }>;
  disk: Array<{ name: string; type: string; total: number; used: number; usage: number; mount: string }>;
  network: { upload: number; download: number };
  os: { hostname: string; platform: string; uptime: number };
}

export function useSystemStats() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource("/api/system/stream");
    eventSourceRef.current = es;

    es.onopen = () => setIsConnected(true);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setStats(data);
      } catch {}
    };

    es.onerror = () => {
      setIsConnected(false);
      es.close();
      // Reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      eventSourceRef.current?.close();
      clearTimeout(reconnectTimeoutRef.current);
    };
  }, [connect]);

  return { stats, isConnected };
}
