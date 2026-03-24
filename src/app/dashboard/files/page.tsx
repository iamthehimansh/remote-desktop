"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { formatBytes } from "@/lib/utils";
import {
  Folder, File, ChevronRight, Upload, FolderPlus, ArrowLeft, Download,
  Trash2, Pencil, LayoutGrid, List, Search, Eye, X,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

interface FileItem {
  name: string;
  type: "file" | "directory";
  size: number;
  modified: string | null;
  extension: string | null;
}

export default function FilesPage() {
  const { toast } = useToast();
  const [currentPath, setCurrentPath] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ name: string; content: string } | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDir = useCallback(async (path?: string) => {
    setLoading(true);
    try {
      const params = path ? `?path=${encodeURIComponent(path)}` : "";
      const res = await fetch(`/api/files/list${params}`);
      if (res.ok) {
        const data = await res.json();
        setCurrentPath(data.path);
        setParentPath(data.parent);
        setItems(data.items);
        setSelected(new Set());
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to load directory", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchDir(); }, [fetchDir]);

  const navigate = (name: string) => fetchDir(`${currentPath}\\${name}`);
  const goUp = () => parentPath && fetchDir(parentPath);

  const handleUpload = async (files: FileList) => {
    const formData = new FormData();
    formData.append("path", currentPath);
    Array.from(files).forEach((f) => formData.append("file", f));
    try {
      const res = await fetch("/api/files/upload", { method: "POST", body: formData });
      if (res.ok) {
        toast({ title: "Uploaded" });
        fetchDir(currentPath);
      } else {
        const data = await res.json();
        toast({ title: "Upload failed", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (selected.size === 0) return;
    const paths = Array.from(selected).map((name) => `${currentPath}\\${name}`);
    try {
      const res = await fetch("/api/files/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths }),
      });
      if (res.ok) {
        toast({ title: `Deleted ${selected.size} item(s)` });
        fetchDir(currentPath);
      }
    } catch {}
  };

  const handleRename = async () => {
    if (!renameTarget || !renameName) return;
    try {
      const res = await fetch("/api/files/rename", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oldPath: `${currentPath}\\${renameTarget}`,
          newPath: `${currentPath}\\${renameName}`,
        }),
      });
      if (res.ok) {
        toast({ title: "Renamed" });
        setRenameTarget(null);
        fetchDir(currentPath);
      }
    } catch {}
  };

  const handleNewFolder = async () => {
    if (!newFolderName) return;
    try {
      const res = await fetch("/api/files/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: `${currentPath}\\${newFolderName}` }),
      });
      if (res.ok) {
        toast({ title: "Folder created" });
        setShowNewFolder(false);
        setNewFolderName("");
        fetchDir(currentPath);
      }
    } catch {}
  };

  const handlePreview = async (name: string) => {
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(`${currentPath}\\${name}`)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.content !== undefined) {
          setPreview({ name, content: data.content });
        }
      }
    } catch {}
  };

  const handleDownload = (name: string) => {
    window.open(`/api/files/read?path=${encodeURIComponent(`${currentPath}\\${name}`)}&download=true`);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
  };

  const breadcrumbs = currentPath.split("\\").filter(Boolean);
  const filtered = items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()));

  const toggleSelect = (name: string) => {
    const next = new Set(selected);
    next.has(name) ? next.delete(name) : next.add(name);
    setSelected(next);
  };

  return (
    <div
      className="h-full flex flex-col"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="absolute inset-0 z-50 bg-accent/10 border-2 border-dashed border-accent rounded-lg flex items-center justify-center">
          <p className="text-accent text-lg">Drop files to upload</p>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Button variant="ghost" size="sm" onClick={goUp} disabled={!parentPath} className="text-text-secondary">
          <ArrowLeft className="h-4 w-4" />
        </Button>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 text-xs text-text-secondary overflow-hidden flex-1 min-w-0">
          {breadcrumbs.map((seg, i) => (
            <span key={i} className="flex items-center shrink-0">
              {i > 0 && <ChevronRight className="h-3 w-3 mx-0.5" />}
              <button
                onClick={() => fetchDir(breadcrumbs.slice(0, i + 1).join("\\"))}
                className="hover:text-text-primary truncate max-w-[120px]"
              >
                {seg}
              </button>
            </span>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-secondary" />
            <Input
              placeholder="Filter..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 w-36 pl-7 text-xs bg-elevated border-border text-text-primary"
            />
          </div>
          <Button variant="ghost" size="sm" onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")} className="text-text-secondary">
            {viewMode === "grid" ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowNewFolder(true)} className="text-text-secondary">
            <FolderPlus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()} className="text-text-secondary">
            <Upload className="h-4 w-4" />
          </Button>
          {selected.size > 0 && (
            <Button variant="ghost" size="sm" onClick={handleDelete} className="text-danger">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && handleUpload(e.target.files)} />

      {/* File list */}
      <Card className="bg-surface border-border flex-1 overflow-hidden">
        <CardContent className="p-0 h-full overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-text-secondary text-sm">Loading...</div>
          ) : viewMode === "list" ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-text-secondary border-b border-border">
                  <th className="text-left p-2 pl-3 w-8"></th>
                  <th className="text-left p-2">Name</th>
                  <th className="text-left p-2 w-24">Size</th>
                  <th className="text-left p-2 w-40">Modified</th>
                  <th className="text-right p-2 pr-3 w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr
                    key={item.name}
                    className={`border-b border-border/50 hover:bg-elevated/50 cursor-pointer ${selected.has(item.name) ? "bg-accent/5" : ""}`}
                    onClick={() => item.type === "directory" ? navigate(item.name) : toggleSelect(item.name)}
                  >
                    <td className="p-2 pl-3">
                      <input
                        type="checkbox"
                        checked={selected.has(item.name)}
                        onChange={() => toggleSelect(item.name)}
                        onClick={(e) => e.stopPropagation()}
                        className="accent-accent"
                      />
                    </td>
                    <td className="p-2 flex items-center gap-2">
                      {item.type === "directory" ? (
                        <Folder className="h-4 w-4 text-accent shrink-0" />
                      ) : (
                        <File className="h-4 w-4 text-text-secondary shrink-0" />
                      )}
                      <span className="text-text-primary truncate">{item.name}</span>
                    </td>
                    <td className="p-2 text-text-secondary font-mono text-xs">
                      {item.type === "file" ? formatBytes(item.size) : "--"}
                    </td>
                    <td className="p-2 text-text-secondary text-xs">
                      {item.modified ? new Date(item.modified).toLocaleString() : "--"}
                    </td>
                    <td className="p-2 pr-3 text-right">
                      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        {item.type === "file" && (
                          <>
                            <button onClick={() => handlePreview(item.name)} className="p-1 text-text-secondary hover:text-text-primary">
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => handleDownload(item.name)} className="p-1 text-text-secondary hover:text-text-primary">
                              <Download className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => { setRenameTarget(item.name); setRenameName(item.name); }}
                          className="p-1 text-text-secondary hover:text-text-primary"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 p-3">
              {filtered.map((item) => (
                <button
                  key={item.name}
                  onClick={() => item.type === "directory" ? navigate(item.name) : toggleSelect(item.name)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-lg hover:bg-elevated/50 ${selected.has(item.name) ? "bg-accent/5" : ""}`}
                >
                  {item.type === "directory" ? (
                    <Folder className="h-8 w-8 text-accent" />
                  ) : (
                    <File className="h-8 w-8 text-text-secondary" />
                  )}
                  <span className="text-xs text-text-primary truncate w-full text-center">{item.name}</span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview dialog */}
      <Dialog open={!!preview} onOpenChange={() => setPreview(null)}>
        <DialogContent className="bg-surface border-border max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="text-text-primary">{preview?.name}</DialogTitle>
          </DialogHeader>
          <pre className="bg-elevated rounded-md p-4 overflow-auto text-xs text-text-primary font-mono max-h-[60vh]">
            {preview?.content}
          </pre>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={() => setRenameTarget(null)}>
        <DialogContent className="bg-surface border-border">
          <DialogHeader>
            <DialogTitle className="text-text-primary">Rename</DialogTitle>
          </DialogHeader>
          <Input
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            className="bg-elevated border-border text-text-primary"
            autoFocus
          />
          <DialogFooter>
            <Button onClick={handleRename} className="bg-accent hover:bg-accent-hover text-white">
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New folder dialog */}
      <Dialog open={showNewFolder} onOpenChange={setShowNewFolder}>
        <DialogContent className="bg-surface border-border">
          <DialogHeader>
            <DialogTitle className="text-text-primary">New Folder</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Folder name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            className="bg-elevated border-border text-text-primary"
            autoFocus
          />
          <DialogFooter>
            <Button onClick={handleNewFolder} className="bg-accent hover:bg-accent-hover text-white">
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
