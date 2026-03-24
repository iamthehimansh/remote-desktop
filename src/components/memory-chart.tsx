"use client";

import { useRef, useEffect } from "react";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface MemoryChartProps {
  usage: number;
}

const MAX_POINTS = 30;

export function MemoryChart({ usage }: MemoryChartProps) {
  const dataRef = useRef<Array<{ time: number; value: number }>>([]);

  useEffect(() => {
    dataRef.current = [
      ...dataRef.current.slice(-(MAX_POINTS - 1)),
      { time: Date.now(), value: usage },
    ];
  }, [usage]);

  const data = dataRef.current.map((d, i) => ({
    index: i,
    value: Number(d.value.toFixed(1)),
  }));

  return (
    <Card className="bg-surface border-border">
      <CardHeader className="pb-2 px-4 pt-4">
        <CardTitle className="text-sm text-text-secondary">Memory Usage</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="index" hide />
            <YAxis domain={[0, 100]} tick={{ fill: "#a1a1aa", fontSize: 10 }} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, fontSize: 12 }}
              labelStyle={{ display: "none" }}
              formatter={(v: number) => [`${v}%`, "RAM"]}
            />
            <Area type="monotone" dataKey="value" stroke="#22c55e" fill="url(#memGrad)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
