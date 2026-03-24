"use client";

import { useState, useEffect, useCallback } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, ArrowUpDown } from "lucide-react";

interface Process {
  pid: number;
  name: string;
  cpu: number;
  memory: number;
  state: string;
}

type SortKey = "cpu" | "memory" | "name" | "pid";

export function ProcessTable() {
  const [processes, setProcesses] = useState<Process[]>([]);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("cpu");
  const [sortAsc, setSortAsc] = useState(false);

  const fetchProcesses = useCallback(async () => {
    try {
      const res = await fetch("/api/system/processes");
      if (res.ok) {
        setProcesses(await res.json());
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchProcesses();
    const interval = setInterval(fetchProcesses, 10000);
    return () => clearInterval(interval);
  }, [fetchProcesses]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const filtered = processes
    .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const mul = sortAsc ? 1 : -1;
      if (sortKey === "name") return mul * a.name.localeCompare(b.name);
      return mul * ((a[sortKey] as number) - (b[sortKey] as number));
    });

  const SortHeader = ({ label, sortField }: { label: string; sortField: SortKey }) => (
    <TableHead
      className="cursor-pointer select-none text-text-secondary hover:text-text-primary"
      onClick={() => handleSort(sortField)}
    >
      <div className="flex items-center gap-1">
        {label}
        <ArrowUpDown className="h-3 w-3" />
      </div>
    </TableHead>
  );

  return (
    <Card className="bg-surface border-border">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm text-text-secondary">Processes</CardTitle>
          <div className="relative w-48">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-secondary" />
            <Input
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 pl-7 text-xs bg-elevated border-border text-text-primary"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="max-h-[300px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <SortHeader label="PID" sortField="pid" />
                <SortHeader label="Name" sortField="name" />
                <SortHeader label="CPU %" sortField="cpu" />
                <SortHeader label="Memory %" sortField="memory" />
                <TableHead className="text-text-secondary">State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 30).map((p) => (
                <TableRow key={p.pid} className="border-border hover:bg-elevated/50">
                  <TableCell className="font-mono text-xs text-text-secondary">{p.pid}</TableCell>
                  <TableCell className="text-xs text-text-primary truncate max-w-[200px]">{p.name}</TableCell>
                  <TableCell className="font-mono text-xs text-text-primary">{p.cpu.toFixed(1)}</TableCell>
                  <TableCell className="font-mono text-xs text-text-primary">{p.memory.toFixed(1)}</TableCell>
                  <TableCell className="text-xs text-text-secondary">{p.state}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
