import si from "systeminformation";

interface SystemStats {
  cpu: {
    model: string;
    cores: number;
    threads: number;
    speed: number;
    usage: number;
    temperature: number | null;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usage: number;
  };
  gpu: {
    model: string;
    usage: number;
    temperature: number | null;
    vramTotal: number;
    vramUsed: number;
  } | null;
  disk: Array<{
    name: string;
    type: string;
    total: number;
    used: number;
    usage: number;
    mount: string;
  }>;
  network: {
    upload: number;
    download: number;
  };
  os: {
    hostname: string;
    platform: string;
    uptime: number;
  };
}

let cachedStats: SystemStats | null = null;
let cacheTime = 0;
const CACHE_TTL = 1000; // 1 second

export async function getSystemStats(): Promise<SystemStats> {
  const now = Date.now();
  if (cachedStats && now - cacheTime < CACHE_TTL) {
    return cachedStats;
  }

  const [cpu, cpuLoad, cpuTemp, mem, graphics, disks, networkStats, osInfo, time] =
    await Promise.all([
      si.cpu(),
      si.currentLoad(),
      si.cpuTemperature(),
      si.mem(),
      si.graphics(),
      si.fsSize(),
      si.networkStats(),
      si.osInfo(),
      si.time(),
    ]);

  // Prefer dedicated NVIDIA/AMD GPU over integrated Intel
  const gpu = graphics.controllers.find(
    (g) => g.vendor?.toLowerCase().includes("nvidia") || g.vendor?.toLowerCase().includes("amd") || g.model?.toLowerCase().includes("nvidia") || g.model?.toLowerCase().includes("radeon")
  ) || graphics.controllers[0];
  const netTotal = networkStats.reduce(
    (acc, iface) => ({
      upload: acc.upload + (iface.tx_sec || 0),
      download: acc.download + (iface.rx_sec || 0),
    }),
    { upload: 0, download: 0 }
  );

  const stats: SystemStats = {
    cpu: {
      model: cpu.brand,
      cores: cpu.physicalCores,
      threads: cpu.cores,
      speed: cpu.speed,
      usage: cpuLoad.currentLoad,
      temperature: cpuTemp.main,
    },
    memory: {
      total: mem.total,
      used: mem.used,
      free: mem.free,
      usage: (mem.used / mem.total) * 100,
    },
    gpu: gpu
      ? {
          model: gpu.model,
          usage: gpu.utilizationGpu ?? 0,
          temperature: gpu.temperatureGpu ?? null,
          vramTotal: (gpu.vram ?? 0) * 1024 * 1024,
          vramUsed: (gpu.memoryUsed ?? 0) * 1024 * 1024,
        }
      : null,
    disk: disks
      .filter((d) => d.size > 0)
      .map((d) => ({
        name: d.fs,
        type: d.type,
        total: d.size,
        used: d.used,
        usage: d.use,
        mount: d.mount,
      })),
    network: netTotal,
    os: {
      hostname: osInfo.hostname,
      platform: `${osInfo.distro} ${osInfo.release}`,
      uptime: time.uptime,
    },
  };

  cachedStats = stats;
  cacheTime = now;
  return stats;
}

export async function getProcesses() {
  const data = await si.processes();
  return data.list
    .sort((a, b) => b.cpu - a.cpu)
    .slice(0, 50)
    .map((p) => ({
      pid: p.pid,
      name: p.name,
      cpu: p.cpu,
      memory: p.mem,
      state: p.state,
    }));
}
