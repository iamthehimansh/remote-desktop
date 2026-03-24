"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  BookOpen, Code, Bot, Box, Play, Square, ExternalLink, Loader2,
  Plus, Trash2, AppWindow, Settings, Eye, EyeOff,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface AppInfo {
  id: string;
  name: string;
  icon: string;
  description: string;
  command: string;
  port: number;
  subdomain: string;
  authType: string;
  authParam?: string;
  status: "stopped" | "starting" | "running";
  url?: string;
  custom?: boolean;
  username?: string;
  password?: string;
}

const ICONS: Record<string, any> = {
  BookOpen, Code, Bot, Box, AppWindow,
};

export default function AppsPage() {
  const { toast } = useToast();
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [appTokens, setAppTokens] = useState<Record<string, string>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [newApp, setNewApp] = useState({
    name: "", command: "", port: "", subdomain: "", description: "",
  });
  const [adding, setAdding] = useState(false);
  const [settingsApp, setSettingsApp] = useState<AppInfo | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchApps = useCallback(async () => {
    try {
      const res = await fetch("/api/apps/list");
      if (res.ok) {
        const data = await res.json();
        setApps(data.apps);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchApps(); }, [fetchApps]);
  useEffect(() => {
    if (!loading) {
      const interval = setInterval(fetchApps, 5000);
      return () => clearInterval(interval);
    }
  }, [loading, fetchApps]);

  const startApp = async (id: string) => {
    setActionId(id);
    try {
      const res = await fetch("/api/apps/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "App started", description: data.url });
        if (data.token) {
          setAppTokens((prev) => ({ ...prev, [id]: data.token }));
        }
        fetchApps();
      } else {
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to start", variant: "destructive" });
    } finally {
      setActionId(null);
    }
  };

  const stopApp = async (id: string) => {
    setActionId(id);
    try {
      const res = await fetch("/api/apps/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        toast({ title: "App stopped" });
        setAppTokens((prev) => { const n = { ...prev }; delete n[id]; return n; });
        fetchApps();
      }
    } catch {
      toast({ title: "Failed to stop", variant: "destructive" });
    } finally {
      setActionId(null);
    }
  };

  const openApp = (app: AppInfo) => {
    let url = app.url || `https://${app.subdomain}.himansh.in`;
    // Use saved password or session token
    const token = app.password || appTokens[app.id];

    if (token && app.authType === "token-query" && app.authParam) {
      const sep = url.includes("?") ? "&" : "?";
      url = `${url}${sep}${app.authParam}=${token}`;
    }

    window.open(url, "_blank");
  };

  const openSettings = (app: AppInfo) => {
    setSettingsApp(app);
    setEditUsername(app.username || "");
    setEditPassword(app.password || "");
    setShowPassword(false);
  };

  const saveCredentials = async () => {
    if (!settingsApp) return;
    setSaving(true);
    try {
      const res = await fetch("/api/apps/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: settingsApp.id,
          username: editUsername,
          password: editPassword,
        }),
      });
      if (res.ok) {
        toast({ title: "Credentials saved", description: "Will be used on next app start." });
        setSettingsApp(null);
        fetchApps();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const createApp = async () => {
    setAdding(true);
    try {
      const res = await fetch("/api/apps/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newApp),
      });
      if (res.ok) {
        toast({ title: "App added" });
        setShowAdd(false);
        setNewApp({ name: "", command: "", port: "", subdomain: "", description: "" });
        fetchApps();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to create app", variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  const deleteApp = async (id: string) => {
    try {
      const res = await fetch("/api/apps/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        toast({ title: "App removed" });
        fetchApps();
      }
    } catch {}
  };

  const getIcon = (iconName: string) => ICONS[iconName] || Box;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-text-primary">Apps</h1>
        <Button onClick={() => setShowAdd(true)} className="bg-accent hover:bg-accent-hover text-white">
          <Plus className="h-4 w-4 mr-1" /> Add App
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-6 w-6 animate-spin text-text-secondary" />
        </div>
      ) : apps.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-text-secondary">
          <AppWindow className="h-8 w-8 mb-2" />
          <p className="text-sm">No apps configured</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {apps.map((app) => {
            const Icon = getIcon(app.icon);
            const isActing = actionId === app.id;
            return (
              <Card key={app.id} className="bg-surface border-border">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-elevated rounded-lg">
                        <Icon className="h-6 w-6 text-accent" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-text-primary">{app.name}</h3>
                        <p className="text-xs text-text-secondary">{app.subdomain}.himansh.in:{app.port}</p>
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className={
                        app.status === "running" ? "bg-success/10 text-success" :
                        app.status === "starting" ? "bg-warning/10 text-warning" :
                        "bg-elevated text-text-secondary"
                      }
                    >
                      {app.status}
                    </Badge>
                  </div>

                  <p className="text-xs text-text-secondary mb-4 line-clamp-2">{app.description}</p>

                  <div className="flex items-center gap-2">
                    {app.status === "stopped" ? (
                      <Button
                        size="sm"
                        onClick={() => startApp(app.id)}
                        disabled={isActing}
                        className="bg-success hover:bg-success/90 text-white flex-1"
                      >
                        {isActing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                        Start
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          onClick={() => openApp(app)}
                          className="bg-accent hover:bg-accent-hover text-white flex-1"
                        >
                          <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => stopApp(app.id)}
                          disabled={isActing}
                          className="text-danger hover:text-danger/80"
                        >
                          {isActing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openSettings(app)}
                      className="text-text-secondary hover:text-text-primary"
                      title="Credentials"
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </Button>
                    {app.custom && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteApp(app.id)}
                        className="text-danger hover:text-danger/80"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add Custom App Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="bg-surface border-border">
          <DialogHeader>
            <DialogTitle className="text-text-primary">Add Custom App</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-text-secondary mb-1 block">App Name</label>
              <Input
                placeholder="e.g. My Python Server"
                value={newApp.name}
                onChange={(e) => setNewApp({ ...newApp, name: e.target.value })}
                className="bg-elevated border-border text-text-primary"
              />
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Start Command</label>
              <Input
                placeholder="e.g. python -m http.server {port}"
                value={newApp.command}
                onChange={(e) => setNewApp({ ...newApp, command: e.target.value })}
                className="bg-elevated border-border text-text-primary font-mono text-sm"
              />
              <p className="text-xs text-text-secondary mt-1">Use {"{port}"} and {"{token}"} as placeholders</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-text-secondary mb-1 block">Port</label>
                <Input
                  type="number"
                  placeholder="e.g. 8000"
                  value={newApp.port}
                  onChange={(e) => setNewApp({ ...newApp, port: e.target.value })}
                  className="bg-elevated border-border text-text-primary font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-text-secondary mb-1 block">Subdomain</label>
                <div className="flex items-center">
                  <Input
                    placeholder="e.g. myapp"
                    value={newApp.subdomain}
                    onChange={(e) => setNewApp({ ...newApp, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                    className="bg-elevated border-border text-text-primary rounded-r-none"
                  />
                  <span className="px-2 py-2 bg-elevated border border-l-0 border-border text-text-secondary text-xs rounded-r-md">.himansh.in</span>
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Description (optional)</label>
              <Input
                placeholder="What does this app do?"
                value={newApp.description}
                onChange={(e) => setNewApp({ ...newApp, description: e.target.value })}
                className="bg-elevated border-border text-text-primary"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={createApp}
              disabled={adding || !newApp.name || !newApp.command || !newApp.port || !newApp.subdomain}
              className="bg-accent hover:bg-accent-hover text-white"
            >
              {adding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Add App
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* App Credentials Dialog */}
      <Dialog open={!!settingsApp} onOpenChange={() => setSettingsApp(null)}>
        <DialogContent className="bg-surface border-border">
          <DialogHeader>
            <DialogTitle className="text-text-primary">
              {settingsApp?.name} — Credentials
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-text-secondary">
              Set username and password for this app. These are used when launching the app and for auto-login via the Open button.
            </p>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Username</label>
              <Input
                placeholder="admin"
                value={editUsername}
                onChange={(e) => setEditUsername(e.target.value)}
                className="bg-elevated border-border text-text-primary"
              />
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Password / Token</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="Set a password"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    className="bg-elevated border-border text-text-primary pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
            {settingsApp?.password && (
              <p className="text-xs text-success">Credentials are set. Will be used on next start.</p>
            )}
            {!settingsApp?.password && (
              <p className="text-xs text-warning">No credentials set. A random token will be generated on start.</p>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={saveCredentials}
              disabled={saving}
              className="bg-accent hover:bg-accent-hover text-white"
            >
              {saving ? "Saving..." : "Save Credentials"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
