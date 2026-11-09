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

export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = -1;
  do {
    n /= 1000;
    i++;
  } while (n >= 1000 && i < units.length - 1);
  return `${n >= 100 ? n.toFixed(0) : n.toFixed(1)} ${units[i]}`;
}

export function formatDate(ms: number | null): string {
  if (ms === null) return "";
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function kindLabel(e: Entry): string {
  if (e.kind === "folder") return "Folder";
  return e.ext ? `${e.ext.toUpperCase()} file` : "File";
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
