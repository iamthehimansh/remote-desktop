"use client";

import { useRef, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatSpeed } from "@/lib/utils";

interface NetworkChartProps {
  upload: number;
  download: number;
}

const MAX_POINTS = 30;

export function NetworkChart({ upload, download }: NetworkChartProps) {
  const dataRef = useRef<Array<{ upload: number; download: number }>>([]);

  useEffect(() => {
    dataRef.current = [
      ...dataRef.current.slice(-(MAX_POINTS - 1)),
      { upload, download },
    ];
  }, [upload, download]);

  const data = dataRef.current.map((d, i) => ({
    index: i,
    upload: d.upload,
    download: d.download,
  }));

  return (
    <Card className="bg-surface border-border">
      <CardHeader className="pb-2 px-4 pt-4">
        <CardTitle className="text-sm text-text-secondary">Network</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <XAxis dataKey="index" hide />
            <YAxis tick={{ fill: "#a1a1aa", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => formatSpeed(v)} />
            <Tooltip
              contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6, fontSize: 12 }}
              labelStyle={{ display: "none" }}
              formatter={(v: number, name: string) => [formatSpeed(v), name === "upload" ? "Upload" : "Download"]}
            />
            <Line type="monotone" dataKey="upload" stroke="#eab308" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="download" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        <div className="flex gap-4 mt-1 justify-center">
          <span className="text-xs text-text-secondary flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#eab308]" /> Upload
          </span>
          <span className="text-xs text-text-secondary flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#3b82f6]" /> Download
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
