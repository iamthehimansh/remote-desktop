"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Share2, Trash2, ExternalLink, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Tunnel {
  name: string;
  hostname: string;
  url: string;
  target: string;
  client: string;
  createdAt: string;
}

export default function TunnelsPage() {
  const { toast } = useToast();
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);

  const fetchTunnels = useCallback(async () => {
    try {
      const res = await fetch("/api/tunnels/list");
      if (res.ok) {
        const data = await res.json();
        setTunnels(data.tunnels || []);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTunnels();
    const id = setInterval(fetchTunnels, 5000); // tunnels are ephemeral — refresh
    return () => clearInterval(id);
  }, [fetchTunnels]);

  const killTunnel = async (name: string) => {
    setRemoving(name);
    try {
      const res = await fetch("/api/tunnels/remove", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        toast({ title: "Tunnel stopped" });
        fetchTunnels();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to stop tunnel", variant: "destructive" });
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-text-primary">SSH Tunnels</h1>
      </div>

      <Card className="bg-surface border-border">
        <CardHeader>
          <CardTitle className="text-text-primary text-sm">How to connect</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-text-secondary">
          <p>One-time setup on any client machine (installs cloudflared + an ssh-config entry):</p>
          <pre className="bg-elevated border border-border rounded-md p-3 text-xs overflow-x-auto text-text-primary">
{`# install cloudflared (brew install cloudflared / winget / curl), then:
printf 'Host names.himansh.in\\n    ProxyCommand cloudflared access ssh --hostname %h\\n' >> ~/.ssh/config`}
          </pre>
          <p>Then expose any local port (you'll be asked for a name):</p>
          <pre className="bg-elevated border border-border rounded-md p-3 text-xs overflow-x-auto text-text-primary">
{`ssh -R 80:localhost:3000 names.himansh.in   →   https://<name>.himansh.in`}
          </pre>
        </CardContent>
      </Card>

      <Card className="bg-surface border-border">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-text-secondary text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading...
            </div>
          ) : tunnels.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-text-secondary">
              <Share2 className="h-8 w-8 mb-2" />
              <p className="text-sm">No active tunnels</p>
              <p className="text-xs mt-1">Run an <span className="font-mono">ssh -R</span> from a client to create one</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-text-secondary">Public URL</TableHead>
                  <TableHead className="text-text-secondary">Client</TableHead>
                  <TableHead className="text-text-secondary">Started</TableHead>
                  <TableHead className="text-text-secondary text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tunnels.map((t) => (
                  <TableRow key={t.name} className="border-border hover:bg-elevated/50">
                    <TableCell>
                      <a
                        href={t.url}
                        target="_blank"
                        rel="noopener"
                        className="text-accent hover:underline flex items-center gap-1 text-sm"
                      >
                        {t.hostname}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-text-secondary">{t.client}</TableCell>
                    <TableCell className="text-xs text-text-secondary">
                      {new Date(t.createdAt).toLocaleTimeString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => killTunnel(t.name)}
                        disabled={removing === t.name}
                        className="text-danger hover:text-danger/80"
                      >
                        {removing === t.name ? (
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
    </div>
  );
}
