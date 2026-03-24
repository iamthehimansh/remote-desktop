"use client";

import { useSystemStats } from "@/hooks/use-system-stats";
import { StatCard } from "@/components/stat-card";
import { CpuChart } from "@/components/cpu-chart";
import { MemoryChart } from "@/components/memory-chart";
import { NetworkChart } from "@/components/network-chart";
import { ProcessTable } from "@/components/process-table";
import { formatBytes, formatPercent } from "@/lib/utils";
import { Cpu, MemoryStick, MonitorSpeaker, HardDrive } from "lucide-react";

function diskColor(usage: number): string {
  if (usage < 60) return "text-success";
  if (usage < 85) return "text-warning";
  return "text-danger";
}

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
    <div className="space-y-4">
      {/* Status indicator */}
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${isConnected ? "bg-success" : "bg-danger"}`} />
        <span className="text-xs text-text-secondary">
          {isConnected ? "Live" : "Reconnecting..."}
        </span>
      </div>

      {/* CPU + Memory */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
      </div>

      {/* GPU cards — show ALL GPUs */}
      {stats.gpus.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {stats.gpus.map((gpu, i) => {
            const isNvidia = gpu.vendor.toLowerCase().includes("nvidia") || gpu.model.toLowerCase().includes("nvidia") || gpu.model.toLowerCase().includes("geforce");
            return (
              <StatCard
                key={i}
                title={isNvidia ? "NVIDIA GPU" : "iGPU"}
                value={gpu.usage !== null ? formatPercent(gpu.usage) : "N/A"}
                subtitle={`${gpu.model}${gpu.temperature ? ` | ${gpu.temperature}°C` : ""}${gpu.vramUsed ? ` | VRAM ${formatBytes(gpu.vramUsed)}/${formatBytes(gpu.vramTotal)}` : ""}`}
                icon={MonitorSpeaker}
                color={isNvidia ? "text-success" : "text-warning"}
                progress={gpu.usage ?? undefined}
              />
            );
          })}
        </div>
      )}

      {/* Disk cards — show ALL drives with dynamic color */}
      {stats.disk.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {stats.disk.map((d) => (
            <StatCard
              key={d.mount}
              title={`Disk ${d.mount}`}
              value={`${formatBytes(d.used)} / ${formatBytes(d.total)}`}
              subtitle={`${d.name} | ${formatPercent(d.usage)}`}
              icon={HardDrive}
              color={diskColor(d.usage)}
              progress={d.usage}
            />
          ))}
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <CpuChart usage={stats.cpu.usage} />
        <MemoryChart usage={stats.memory.usage} />
        <NetworkChart upload={stats.network.upload} download={stats.network.download} />
      </div>

      {/* Process table */}
      <ProcessTable />
    </div>
  );
}
