import type { Entry } from "./logic";

export interface Place {
  name: string;
  path: string;
  kind: "home" | "folder" | "drive";
}
export type SortKey = "name" | "size" | "modified" | "kind";
export type Resolution = "replace" | "keepboth" | "skip";
export interface OpResult {
  paths: string[];
  skipped: number;
  errors: string[];
  can_undo: boolean;
}

// Outside Tauri (plain browser, tests, screenshots) an in-memory file system stands in.
const inTauri = "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (inTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }
  const { mock } = await import("./mock");
  return mock<T>(cmd, args ?? {});
}

export const api = {
  homeDir: () => call<string>("home_dir"),
  places: () => call<Place[]>("list_places"),
  listDir: (path: string, showHidden: boolean, sort: SortKey, ascending: boolean) =>
    call<Entry[]>("list_dir", { path, showHidden, sort, ascending }),
  parentDir: (path: string) => call<string | null>("parent_dir", { path }),
  checkConflicts: (sources: string[], dest: string) => call<string[]>("check_conflicts", { sources, dest }),
  transfer: (sources: string[], dest: string, kind: "copy" | "move", resolutions: Record<string, Resolution>) =>
    call<OpResult>("transfer", { sources, dest, kind, resolutions }),
  trash: (targets: string[]) => call<OpResult>("trash", { targets }),
  rename: (path: string, newName: string) => call<OpResult>("rename", { path, newName }),
  newFolder: (dir: string) => call<OpResult>("new_folder", { dir }),
  duplicate: (targets: string[]) => call<OpResult>("duplicate", { targets }),
  undo: () => call<{ label: string; can_undo: boolean }>("undo"),
  folderSize: (path: string) => call<{ bytes: number; items: number }>("folder_size", { path }),
  diskFree: (path: string) => call<number | null>("disk_free", { path }),
  openPath: (path: string) => call<void>("open_path", { path }),
  watchDirs: (dirs: string[]) => call<void>("watch_dirs", { dirs }),
};

/** Calls `cb` with the folders that changed on disk. */
export async function onDirChanged(cb: (dirs: string[]) => void): Promise<void> {
  if (inTauri) {
    const { listen } = await import("@tauri-apps/api/event");
    await listen<string[]>("dir-changed", (e) => cb(e.payload));
  } else {
    window.addEventListener("mock-dir-changed", (e) => cb((e as CustomEvent<string[]>).detail));
  }
}
