// In-memory stand-in for the Rust commands, used when the page runs outside Tauri.
import type { Entry } from "./logic";
import { baseName, joinPath } from "./logic";

interface Node {
  dir: boolean;
  size: number;
  modified: number;
}
const now = Date.now();
const fs = new Map<string, Node>();
const dir = (p: string) => fs.set(p, { dir: true, size: 0, modified: now });
const file = (p: string, size: number, age = 0) => fs.set(p, { dir: false, size, modified: now - age * 3600_000 });

["/", "/home", "/home/me", "/home/me/Documents", "/home/me/Downloads", "/home/me/Pictures",
  "/home/me/Documents/Projects", "/home/me/Documents/Taxes 2025"].forEach(dir);
file("/home/me/Documents/report.pdf", 482_113, 3);
file("/home/me/Documents/notes.txt", 1_204, 30);
file("/home/me/Documents/budget.xlsx", 88_400, 70);
file("/home/me/Documents/file2.txt", 10);
file("/home/me/Documents/file10.txt", 10);
file("/home/me/Documents/.hidden", 1);
file("/home/me/Documents/Projects/shark.zip", 12_400_000, 5);
file("/home/me/Downloads/installer.AppImage", 98_000_000, 1);
file("/home/me/Downloads/notes.txt", 999, 2);
file("/home/me/Pictures/holiday.jpg", 3_400_000, 200);

const parent = (p: string) => (p === "/" ? null : p.slice(0, p.lastIndexOf("/")) || "/");
const children = (p: string) => [...fs.keys()].filter((k) => k !== "/" && parent(k) === p);
const under = (root: string) => [...fs.keys()].filter((k) => k === root || k.startsWith(root === "/" ? "/" : root + "/"));
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const undoStack: { label: string; run: () => void }[] = [];

function unique(dest: string, name: string, isDir: boolean): string {
  let target = joinPath(dest, name);
  const i = name.lastIndexOf(".");
  const [stem, ext] = !isDir && i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ""];
  for (let n = 2; fs.has(target); n++) target = joinPath(dest, `${stem} ${n}${ext}`);
  return target;
}

function changed(...dirs: string[]) {
  setTimeout(() => window.dispatchEvent(new CustomEvent("mock-dir-changed", { detail: dirs })), 50);
}

function copyTree(from: string, to: string) {
  for (const k of under(from)) fs.set(to + k.slice(from.length), { ...fs.get(k)! });
}
function removeTree(p: string) {
  for (const k of under(p)) fs.delete(k);
}
function snapshot(p: string) {
  return under(p).map((k) => [k, { ...fs.get(k)! }] as const);
}

const result = (paths: string[] = [], skipped = 0, errors: string[] = []) => ({
  paths, skipped, errors, can_undo: undoStack.length > 0,
});

export async function mock<T>(cmd: string, a: Record<string, any>): Promise<T> {
  const out = (v: unknown) => v as T;
  switch (cmd) {
    case "home_dir":
      return out("/home/me");
    case "list_places":
      return out([
        { name: "Home", path: "/home/me", kind: "home" },
        { name: "Documents", path: "/home/me/Documents", kind: "folder" },
        { name: "Downloads", path: "/home/me/Downloads", kind: "folder" },
        { name: "Pictures", path: "/home/me/Pictures", kind: "folder" },
        { name: "Computer", path: "/", kind: "drive" },
      ]);
    case "parent_dir":
      return out(parent(a.path));
    case "list_dir": {
      if (!fs.get(a.path)?.dir) throw "No such folder";
      let list: Entry[] = children(a.path).map((p) => {
        const n = fs.get(p)!;
        const name = baseName(p);
        const i = name.lastIndexOf(".");
        return {
          name, path: p, kind: n.dir ? "folder" : "file", is_symlink: false, size: n.size, modified: n.modified,
          hidden: name.startsWith("."), ext: !n.dir && i > 0 ? name.slice(i + 1).toLowerCase() : "",
        } as Entry;
      });
      if (!a.showHidden) list = list.filter((e) => !e.hidden);
      list.sort((x, y) => {
        if (x.kind !== y.kind) return x.kind === "folder" ? -1 : 1;
        let c = natural.compare(x.name, y.name);
        if (a.sort === "size") c = x.size - y.size || c;
        if (a.sort === "modified") c = (x.modified ?? 0) - (y.modified ?? 0) || c;
        if (a.sort === "kind") c = x.ext.localeCompare(y.ext) || c;
        return a.ascending ? c : -c;
      });
      return out(list);
    }
    case "check_conflicts":
      return out((a.sources as string[]).filter((s) => parent(s) !== a.dest && fs.has(joinPath(a.dest, baseName(s)))));
    case "transfer": {
      const created: string[] = [], moved: [string, string][] = [], replaced: (readonly [string, Node])[] = [];
      let skipped = 0;
      for (const s of a.sources as string[]) {
        const name = baseName(s);
        const isDir = fs.get(s)!.dir;
        let t = joinPath(a.dest, name);
        if (parent(s) === a.dest) {
          if (a.kind === "move") { skipped++; continue; }
          t = unique(a.dest, name, isDir);
        } else if (fs.has(t)) {
          const r = a.resolutions[s] ?? "skip";
          if (r === "skip") { skipped++; continue; }
          if (r === "keepboth") t = unique(a.dest, name, isDir);
          else { replaced.push(...snapshot(t)); removeTree(t); }
        }
        if (a.kind === "copy") { copyTree(s, t); created.push(t); }
        else { copyTree(s, t); removeTree(s); moved.push([s, t]); }
      }
      const done = [...created, ...moved.map((m) => m[1])];
      undoStack.push({
        label: a.kind,
        run: () => {
          created.forEach(removeTree);
          moved.forEach(([s, t]) => { copyTree(t, s); removeTree(t); });
          replaced.forEach(([k, n]) => fs.set(k, n));
        },
      });
      changed(a.dest, ...moved.map((m) => parent(m[0])!));
      return out(result(done, skipped));
    }
    case "trash": {
      const snaps = (a.targets as string[]).flatMap(snapshot);
      (a.targets as string[]).forEach(removeTree);
      undoStack.push({ label: "trash", run: () => snaps.forEach(([k, n]) => fs.set(k, n)) });
      changed(...(a.targets as string[]).map((t) => parent(t)!));
      return out(result(a.targets));
    }
    case "rename": {
      const t = joinPath(parent(a.path)!, a.newName);
      if (/[\\/]/.test(a.newName) || !a.newName || a.newName === "..") throw "That name can't be used";
      if (t !== a.path && fs.has(t)) throw `"${a.newName}" already exists`;
      copyTree(a.path, t);
      removeTree(a.path);
      undoStack.push({ label: "rename", run: () => { copyTree(t, a.path); removeTree(t); } });
      changed(parent(a.path)!);
      return out(result([t]));
    }
    case "new_folder": {
      const t = unique(a.dir, "untitled folder", true);
      dir(t);
      undoStack.push({ label: "new folder", run: () => removeTree(t) });
      changed(a.dir);
      return out(result([t]));
    }
    case "duplicate": {
      const made: string[] = [];
      for (const p of a.targets as string[]) {
        const name = baseName(p);
        const i = name.lastIndexOf(".");
        const isDir = fs.get(p)!.dir;
        const copyName = !isDir && i > 0 ? `${name.slice(0, i)} copy${name.slice(i)}` : `${name} copy`;
        const t = unique(parent(p)!, copyName, isDir);
        copyTree(p, t);
        made.push(t);
      }
      undoStack.push({ label: "duplicate", run: () => made.forEach(removeTree) });
      changed(...new Set((a.targets as string[]).map((t) => parent(t)!)));
      return out(result(made));
    }
    case "undo": {
      const u = undoStack.pop();
      if (!u) throw "Nothing to undo";
      u.run();
      changed("/home/me", "/home/me/Documents", "/home/me/Downloads");
      return out({ label: u.label, can_undo: undoStack.length > 0 });
    }
    case "folder_size": {
      const all = under(a.path).filter((k) => k !== a.path);
      return out({ bytes: all.reduce((s, k) => s + fs.get(k)!.size, 0), items: all.length });
    }
    default:
      return out(undefined);
  }
}
