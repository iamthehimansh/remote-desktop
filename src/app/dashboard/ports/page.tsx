"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Network, Plus, Trash2, ExternalLink, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Forward {
  id: string;
  localPort: number;
  subdomain: string;
  hostname: string;
  protocol: string;
  status: "active" | "unreachable";
  createdAt: string;
}

export default function PortsPage() {
  const { toast } = useToast();
  const [forwards, setForwards] = useState<Forward[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [port, setPort] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const fetchForwards = useCallback(async () => {
    try {
      const res = await fetch("/api/ports/list");
      if (res.ok) {
        const data = await res.json();
        setForwards(data.forwards);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchForwards(); }, [fetchForwards]);

  const addForward = async () => {
    setAdding(true);
    try {
      const res = await fetch("/api/ports/forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ localPort: Number(port), subdomain, protocol: "http" }),
      });

      if (res.ok) {
        toast({ title: "Port forwarded", description: `${subdomain}.pc.himansh.in → localhost:${port}` });
        setShowAdd(false);
        setPort("");
        setSubdomain("");
        fetchForwards();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to create forward", variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  const removeForwardById = async (id: string) => {
    setRemoving(id);
    try {
      const res = await fetch("/api/ports/remove", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (res.ok) {
        toast({ title: "Forward removed" });
        fetchForwards();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to remove forward", variant: "destructive" });
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-text-primary">Port Forwarding</h1>
        <Button
          onClick={() => setShowAdd(true)}
          className="bg-accent hover:bg-accent-hover text-white"
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Forward
        </Button>
      </div>

      <Card className="bg-surface border-border">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-text-secondary text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading...
            </div>
          ) : forwards.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-text-secondary">
              <Network className="h-8 w-8 mb-2" />
              <p className="text-sm">No active port forwards</p>
              <p className="text-xs mt-1">Click "Add Forward" to expose a local service</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-text-secondary">Subdomain</TableHead>
                  <TableHead className="text-text-secondary">Local Port</TableHead>
                  <TableHead className="text-text-secondary">Protocol</TableHead>
                  <TableHead className="text-text-secondary">Status</TableHead>
                  <TableHead className="text-text-secondary">Created</TableHead>
                  <TableHead className="text-text-secondary text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {forwards.map((f) => (
                  <TableRow key={f.id} className="border-border hover:bg-elevated/50">
                    <TableCell>
                      <a
                        href={`https://${f.hostname}`}
                        target="_blank"
                        rel="noopener"
                        className="text-accent hover:underline flex items-center gap-1 text-sm"
                      >
                        {f.hostname}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-text-primary">{f.localPort}</TableCell>
                    <TableCell className="text-sm text-text-secondary">{f.protocol}</TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={f.status === "active" ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}
                      >
                        {f.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-text-secondary">
                      {new Date(f.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeForwardById(f.id)}
                        disabled={removing === f.id}
                        className="text-danger hover:text-danger/80"
                      >
                        {removing === f.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Forward Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="bg-surface border-border">
          <DialogHeader>
            <DialogTitle className="text-text-primary">Add Port Forward</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Local Port</label>
              <Input
                type="number"
                placeholder="e.g. 8888"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="bg-elevated border-border text-text-primary font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Subdomain</label>
              <div className="flex items-center gap-0">
                <Input
                  placeholder="e.g. jupyter"
                  value={subdomain}
                  onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  className="bg-elevated border-border text-text-primary rounded-r-none"
                />
                <span className="px-3 py-2 bg-elevated border border-l-0 border-border text-text-secondary text-sm rounded-r-md whitespace-nowrap">
                  .pc.himansh.in
                </span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={addForward}
              disabled={adding || !port || !subdomain}
              className="bg-accent hover:bg-accent-hover text-white"
            >
              {adding ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating...</>
              ) : (
                "Forward"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
