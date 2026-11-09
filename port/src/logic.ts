// Pure helpers with no DOM access, so they can be unit tested.

export interface Entry {
  name: string;
  path: string;
  kind: "file" | "folder";
  is_symlink: boolean;
  size: number;
  modified: number | null;
  hidden: boolean;
  ext: string;
}

export function isWindowsPath(p: string): boolean {
  return /^[A-Za-z]:[\\/]?/.test(p) || p.startsWith("\\\\");
}

export interface Crumb {
  label: string;
  path: string;
}

/** "/home/me/docs" -> [/, home, me, docs]; "C:\\Users\\me" -> [C:\\, Users, me]. */
export function breadcrumbs(path: string): Crumb[] {
  if (isWindowsPath(path)) {
    const parts = path.split(/[\\/]+/).filter(Boolean);
    const out: Crumb[] = [];
    let acc = "";
    parts.forEach((part, i) => {
      acc = i === 0 ? `${part}\\` : `${acc.replace(/\\$/, "")}\\${part}`;
      out.push({ label: i === 0 ? `${part}\\` : part, path: acc });
    });
    return out;
  }
  const parts = path.split("/").filter(Boolean);
  const out: Crumb[] = [{ label: "/", path: "/" }];
  parts.forEach((part, i) => out.push({ label: part, path: "/" + parts.slice(0, i + 1).join("/") }));
  return out;
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function joinPath(dir: string, name: string): string {
  const sep = isWindowsPath(dir) ? "\\" : "/";
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

/** Finder-style sizes: "174 bytes", "15 KB", "1.2 MB", "98.71 GB". */
export function formatSize(bytes: number): string {
  if (bytes === 0) return "Zero KB";
  if (bytes === 1) return "1 byte";
  if (bytes < 1000) return `${bytes} bytes`;
  if (bytes < 1e6) return `${Math.round(bytes / 1e3)} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes < 1e12) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${(bytes / 1e12).toFixed(2)} TB`;
}

/** "20 Oct 2026 at 11:32 PM" in the user's locale. */
export function formatDate(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms);
  const day = d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} at ${time}`;
}

const KINDS: Record<string, string> = {
  json: "JSON Document", md: "Markdown Document", txt: "Plain Text Document", pdf: "PDF document",
  png: "PNG image", jpg: "JPEG image", jpeg: "JPEG image", gif: "GIF image", webp: "WebP image", svg: "SVG image",
  zip: "ZIP archive", gz: "GZip archive", tar: "TAR archive", "7z": "7-Zip archive", rar: "RAR archive",
  mp3: "MP3 audio", wav: "WAV audio", flac: "FLAC audio", mp4: "MPEG-4 movie", mkv: "Matroska video",
  html: "HTML document", css: "CSS style sheet", js: "JavaScript source", ts: "TypeScript source",
  rs: "Rust source", py: "Python source", swift: "Swift source", sh: "Shell script",
  doc: "Word document", docx: "Word document", xls: "Excel spreadsheet", xlsx: "Excel spreadsheet",
  csv: "CSV document", ppt: "PowerPoint presentation", pptx: "PowerPoint presentation",
  exe: "Application", msi: "Windows Installer", deb: "Debian package", appimage: "AppImage application",
};

export function kindLabel(e: Entry): string {
  if (e.kind === "folder") return "Folder";
  return KINDS[e.ext] ?? (e.ext ? `${e.ext.toUpperCase()} file` : "Document");
}

/** The status bar: "10 items • 1 selected (Zero KB) • 98.71 GB available". */
export function statusLine(total: number, selected: number, selectedBytes: number | null, free: number | null): string {
  const parts = [`${total} item${total === 1 ? "" : "s"}`];
  if (selected > 0) {
    parts.push(`${selected} selected (${selectedBytes === null ? "calculating…" : formatSize(selectedBytes)})`);
  }
  if (free !== null) parts.push(`${formatSize(free)} available`);
  return parts.join(" • ");
}

/** Back/forward history for one pane. */
export class History {
  private back: string[] = [];
  private fwd: string[] = [];
  constructor(public current: string) {}
  visit(path: string): void {
    if (path === this.current) return;
    this.back.push(this.current);
    this.fwd = [];
    this.current = path;
  }
  canBack(): boolean {
    return this.back.length > 0;
  }
  canForward(): boolean {
    return this.fwd.length > 0;
  }
  goBack(): string | null {
    const p = this.back.pop();
    if (p === undefined) return null;
    this.fwd.push(this.current);
    return (this.current = p);
  }
  goForward(): string | null {
    const p = this.fwd.pop();
    if (p === undefined) return null;
    this.back.push(this.current);
    return (this.current = p);
  }
}

/** Windows-style range: every item from anchor to target in reading order. */
export function rangeBetween(items: Entry[], anchor: string | null, target: string): string[] {
  const t = items.findIndex((e) => e.path === target);
  if (t < 0) return [];
  let a = items.findIndex((e) => e.path === anchor);
  if (a < 0) a = t;
  const [lo, hi] = a < t ? [a, t] : [t, a];
  return items.slice(lo, hi + 1).map((e) => e.path);
}

export type NavKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End";

/** Next cursor index for an arrow key. `cols` is 1 in list view. -1 means nothing is focused yet. */
export function navigate(key: NavKey, cur: number, count: number, cols: number): number {
  if (count === 0) return -1;
  if (cur < 0) return key === "ArrowUp" || key === "End" || key === "ArrowLeft" ? count - 1 : 0;
  const last = count - 1;
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return last;
    case "ArrowUp":
      return Math.max(0, cur - cols);
    case "ArrowDown":
      return Math.min(last, cur + cols);
    case "ArrowLeft":
      return cols > 1 ? Math.max(0, cur - 1) : cur;
    case "ArrowRight":
      return cols > 1 ? Math.min(last, cur + 1) : cur;
  }
}

/** Index of the next item whose name starts with `prefix`, searching from `from` and wrapping. */
export function typeSelect(items: Entry[], prefix: string, from: number): number {
  if (!prefix || items.length === 0) return -1;
  const p = prefix.toLowerCase();
  // Repeating one letter cycles through matches instead of requiring "aaa".
  const cycle = [...p].every((c) => c === p[0]);
  const needle = cycle ? p[0] : p;
  const start = cycle ? from + 1 : Math.max(from, 0);
  for (let i = 0; i < items.length; i++) {
    const idx = (start + i) % items.length;
    if (items[idx].name.toLowerCase().startsWith(needle)) return idx;
  }
  return -1;
}

/** Filename without its extension, for pre-selecting in the rename box. */
export function stemLength(name: string, isFolder: boolean): number {
  const i = name.lastIndexOf(".");
  return isFolder || i <= 0 ? name.length : i;
}
