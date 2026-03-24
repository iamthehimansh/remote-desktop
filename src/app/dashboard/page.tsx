"use client";

import { useSystemStats } from "@/hooks/use-system-stats";
import { StatCard } from "@/components/stat-card";
import { CpuChart } from "@/components/cpu-chart";
import { MemoryChart } from "@/components/memory-chart";
import { NetworkChart } from "@/components/network-chart";
import { ProcessTable } from "@/components/process-table";
import { formatBytes, formatPercent } from "@/lib/utils";
import { Cpu, MemoryStick, MonitorSpeaker, HardDrive } from "lucide-react";

export default function OverviewPage() {
  const { stats, isConnected } = useSystemStats();

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-text-secondary text-sm">Loading system stats...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status indicator */}
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${isConnected ? "bg-success" : "bg-danger"}`} />
        <span className="text-xs text-text-secondary">
          {isConnected ? "Live" : "Reconnecting..."}
        </span>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="CPU"
          value={formatPercent(stats.cpu.usage)}
          subtitle={`${stats.cpu.model} | ${stats.cpu.cores}C/${stats.cpu.threads}T @ ${stats.cpu.speed}GHz`}
          icon={Cpu}
          color="text-accent"
          progress={stats.cpu.usage}
        />
        <StatCard
          title="Memory"
          value={`${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}`}
          subtitle={formatPercent(stats.memory.usage)}
          icon={MemoryStick}
          color="text-success"
          progress={stats.memory.usage}
        />
        <StatCard
          title="GPU"
          value={stats.gpu ? formatPercent(stats.gpu.usage) : "N/A"}
          subtitle={stats.gpu ? `${stats.gpu.model}${stats.gpu.temperature ? ` | ${stats.gpu.temperature}°C` : ""}` : "No GPU detected"}
          icon={MonitorSpeaker}
          color="text-warning"
          progress={stats.gpu?.usage}
        />
        <StatCard
          title="Disk"
          value={stats.disk[0] ? `${formatBytes(stats.disk[0].used)} / ${formatBytes(stats.disk[0].total)}` : "N/A"}
          subtitle={stats.disk[0] ? `${stats.disk[0].mount} | ${formatPercent(stats.disk[0].usage)}` : ""}
          icon={HardDrive}
          color="text-danger"
          progress={stats.disk[0]?.usage}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <CpuChart usage={stats.cpu.usage} />
        <MemoryChart usage={stats.memory.usage} />
        <NetworkChart upload={stats.network.upload} download={stats.network.download} />
      </div>

      {/* Process table */}
      <ProcessTable />
    </div>
  );
}
