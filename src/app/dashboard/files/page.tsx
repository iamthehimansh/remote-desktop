"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { formatBytes } from "@/lib/utils";
import {
  Folder, File, ChevronRight, Upload, FolderPlus, ArrowLeft, Download,
  Trash2, Pencil, LayoutGrid, List, Search, Eye, X, Save, Image, Film,
  Music, FileText, HardDrive,
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

const TEXT_EXTS = new Set([
  ".txt", ".md", ".json", ".js", ".ts", ".tsx", ".jsx", ".css", ".html",
  ".xml", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env",
  ".sh", ".bash", ".bat", ".cmd", ".ps1", ".py", ".rb", ".go", ".rs",
  ".java", ".c", ".cpp", ".h", ".hpp", ".csv", ".sql", ".log", ".gitignore",
  ".svelte", ".vue", ".php", ".swift", ".kt", ".scala", ".r", ".m",
  ".dockerfile", ".makefile", ".gradle", ".properties", ".lock",
]);

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp", ".avif"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".m4v"]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".wma", ".opus"]);
const PDF_EXTS = new Set([".pdf"]);

function getFileType(ext: string | null): "text" | "image" | "video" | "audio" | "pdf" | "other" {
  if (!ext) return "other";
  if (TEXT_EXTS.has(ext)) return "text";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (PDF_EXTS.has(ext)) return "pdf";
  return "other";
}

function getFileIcon(ext: string | null) {
  const type = getFileType(ext);
  switch (type) {
    case "image": return Image;
    case "video": return Film;
    case "audio": return Music;
    case "text": return FileText;
    case "pdf": return FileText;
    default: return File;
  }
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
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Preview/Edit state
  const [previewFile, setPreviewFile] = useState<{
    name: string;
    path: string;
    type: "text" | "image" | "video" | "audio" | "pdf" | "other";
    content?: string;
    editing?: boolean;
    editContent?: string;
  } | null>(null);

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

  useEffect(() => { fetchDir("drives"); }, [fetchDir]);

  const navigate = (name: string) => {
    if (currentPath === "drives") {
      fetchDir(`${name}\\`);
    } else {
      fetchDir(`${currentPath}\\${name}`);
    }
  };
  const goUp = () => parentPath && fetchDir(parentPath === "drives" ? "drives" : parentPath);

  const getFullPath = (name: string) => `${currentPath}\\${name}`;

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
    const paths = Array.from(selected).map((name) => getFullPath(name));
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
          oldPath: getFullPath(renameTarget),
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

  const openPreview = async (name: string, ext: string | null) => {
    const filePath = getFullPath(name);
    const type = getFileType(ext);

    if (type === "text") {
      try {
        const res = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
        if (res.ok) {
          const data = await res.json();
          setPreviewFile({ name, path: filePath, type, content: data.content, editContent: data.content });
        }
      } catch {}
    } else if (type === "image" || type === "video" || type === "audio" || type === "pdf") {
      setPreviewFile({ name, path: filePath, type });
    }
  };

  const saveFile = async () => {
    if (!previewFile?.editing || previewFile.editContent === undefined) return;
    try {
      const res = await fetch("/api/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: previewFile.path, content: previewFile.editContent }),
      });
      if (res.ok) {
        toast({ title: "File saved" });
        setPreviewFile({ ...previewFile, content: previewFile.editContent, editing: false });
      } else {
        const data = await res.json();
        toast({ title: "Save failed", description: data.error, variant: "destructive" });
      }
    } catch {}
  };

  const handleDownload = (name: string) => {
    window.open(`/api/files/read?path=${encodeURIComponent(getFullPath(name))}&download=true`);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
  };

  const isDrives = currentPath === "drives";
  const breadcrumbs = isDrives ? [] : currentPath.split("\\").filter(Boolean);
  const filtered = items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()));

  const toggleSelect = (name: string) => {
    const next = new Set(selected);
    next.has(name) ? next.delete(name) : next.add(name);
    setSelected(next);
  };

  const mediaUrl = (path: string) => `/api/files/read?path=${encodeURIComponent(path)}&stream=true`;

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
          <button onClick={() => fetchDir("drives")} className="hover:text-text-primary shrink-0 font-medium flex items-center gap-1">
            <HardDrive className="h-3 w-3" /> My PC
          </button>
          {breadcrumbs.map((seg, i) => (
            <span key={i} className="flex items-center shrink-0">
              <ChevronRight className="h-3 w-3 mx-0.5" />
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
          {!isDrives && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setShowNewFolder(true)} className="text-text-secondary">
                <FolderPlus className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()} className="text-text-secondary">
                <Upload className="h-4 w-4" />
              </Button>
            </>
          )}
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
                  <th className="text-left p-2 w-40 hidden sm:table-cell">Modified</th>
                  <th className="text-right p-2 pr-3 w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const FileIcon = item.type === "directory" ? Folder : getFileIcon(item.extension);
                  const iconColor = item.type === "directory" ? "text-accent" : "text-text-secondary";
                  return (
                    <tr
                      key={item.name}
                      className={`border-b border-border/50 hover:bg-elevated/50 cursor-pointer ${selected.has(item.name) ? "bg-accent/5" : ""}`}
                      onClick={() => item.type === "directory" ? navigate(item.name) : toggleSelect(item.name)}
                      onDoubleClick={() => item.type === "file" && openPreview(item.name, item.extension)}
                    >
                      <td className="p-2 pl-3">
                        {!isDrives && (
                          <input
                            type="checkbox"
                            checked={selected.has(item.name)}
                            onChange={() => toggleSelect(item.name)}
                            onClick={(e) => e.stopPropagation()}
                            className="accent-accent"
                          />
                        )}
                      </td>
                      <td className="p-2 flex items-center gap-2">
                        <FileIcon className={`h-4 w-4 ${iconColor} shrink-0`} />
                        <span className="text-text-primary truncate">{item.name}</span>
                      </td>
                      <td className="p-2 text-text-secondary font-mono text-xs">
                        {item.type === "file" ? formatBytes(item.size) : "--"}
                      </td>
                      <td className="p-2 text-text-secondary text-xs hidden sm:table-cell">
                        {item.modified ? new Date(item.modified).toLocaleString() : "--"}
                      </td>
                      <td className="p-2 pr-3 text-right">
                        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          {item.type === "file" && (
                            <>
                              <button onClick={() => openPreview(item.name, item.extension)} className="p-1 text-text-secondary hover:text-text-primary" title="Preview">
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => handleDownload(item.name)} className="p-1 text-text-secondary hover:text-text-primary" title="Download">
                                <Download className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                          {!isDrives && (
                            <button
                              onClick={() => { setRenameTarget(item.name); setRenameName(item.name); }}
                              className="p-1 text-text-secondary hover:text-text-primary"
                              title="Rename"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 p-3">
              {filtered.map((item) => {
                const FileIcon = item.type === "directory" ? Folder : getFileIcon(item.extension);
                const iconColor = item.type === "directory" ? "text-accent" : "text-text-secondary";
                return (
                  <button
                    key={item.name}
                    onClick={() => item.type === "directory" ? navigate(item.name) : toggleSelect(item.name)}
                    onDoubleClick={() => item.type === "file" && openPreview(item.name, item.extension)}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-lg hover:bg-elevated/50 ${selected.has(item.name) ? "bg-accent/5" : ""}`}
                  >
                    <FileIcon className={`h-8 w-8 ${iconColor}`} />
                    <span className="text-xs text-text-primary truncate w-full text-center">{item.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview/Edit Modal */}
      <Dialog open={!!previewFile} onOpenChange={() => setPreviewFile(null)}>
        <DialogContent className="bg-surface border-border max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="text-text-primary truncate pr-4">{previewFile?.name}</DialogTitle>
              <div className="flex items-center gap-2 shrink-0">
                {previewFile?.type === "text" && !previewFile.editing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPreviewFile({ ...previewFile!, editing: true })}
                    className="text-accent"
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                  </Button>
                )}
                {previewFile?.editing && (
                  <Button size="sm" onClick={saveFile} className="bg-success hover:bg-success/90 text-white">
                    <Save className="h-3.5 w-3.5 mr-1" /> Save
                  </Button>
                )}
                {previewFile && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDownload(previewFile.name)}
                    className="text-text-secondary"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-auto min-h-0">
            {/* Text preview/edit */}
            {previewFile?.type === "text" && previewFile.editing ? (
              <textarea
                value={previewFile.editContent || ""}
                onChange={(e) => setPreviewFile({ ...previewFile, editContent: e.target.value })}
                className="w-full h-[60vh] bg-elevated rounded-md p-4 text-sm text-text-primary font-mono resize-none border border-border focus:outline-none focus:ring-1 focus:ring-accent"
                spellCheck={false}
              />
            ) : previewFile?.type === "text" ? (
              <pre className="bg-elevated rounded-md p-4 overflow-auto text-sm text-text-primary font-mono max-h-[60vh] whitespace-pre-wrap break-words">
                {previewFile.content}
              </pre>
            ) : null}

            {/* Image preview */}
            {previewFile?.type === "image" && (
              <div className="flex items-center justify-center p-4">
                <img
                  src={mediaUrl(previewFile.path)}
                  alt={previewFile.name}
                  className="max-w-full max-h-[65vh] object-contain rounded-md"
                />
              </div>
            )}

            {/* Video preview with controls (seekable) */}
            {previewFile?.type === "video" && (
              <div className="flex items-center justify-center p-4">
                <video
                  src={mediaUrl(previewFile.path)}
                  controls
                  autoPlay
                  className="max-w-full max-h-[65vh] rounded-md"
                >
                  Your browser does not support video playback.
                </video>
              </div>
            )}

            {/* Audio preview with controls (seekable) */}
            {previewFile?.type === "audio" && (
              <div className="flex flex-col items-center justify-center p-8 gap-4">
                <Music className="h-16 w-16 text-accent" />
                <p className="text-text-primary font-medium">{previewFile.name}</p>
                <audio
                  src={mediaUrl(previewFile.path)}
                  controls
                  autoPlay
                  className="w-full max-w-md"
                >
                  Your browser does not support audio playback.
                </audio>
              </div>
            )}

            {/* PDF preview */}
            {previewFile?.type === "pdf" && (
              <iframe
                src={mediaUrl(previewFile.path)}
                className="w-full h-[70vh] rounded-md border-0"
                title={previewFile.name}
              />
            )}
          </div>
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
