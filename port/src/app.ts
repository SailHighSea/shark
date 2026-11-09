import { api, onDirChanged, type Place, type Resolution, type SortKey } from "./api";
import { iconFor, listIcon, placeIcon, ui } from "./icons";
import {
  baseName, breadcrumbs, formatDate, formatSize, History, kindLabel, navigate, rangeBetween,
  statusLine, stemLength, typeSelect, type Entry, type NavKey,
} from "./logic";

interface Pane {
  history: History;
  entries: Entry[];
  selected: Set<string>;
  anchor: string | null;
  cursor: string | null;
  error: string | null;
  filter: string;
}
interface Tab {
  id: number;
  panes: Pane[];
  active: number;
}
interface Settings {
  view: "list" | "icons";
  sortKey: SortKey;
  ascending: boolean;
  showHidden: boolean;
  zoom: number;
  collapsed: string[];
}

const settings: Settings = { view: "list", sortKey: "name", ascending: true, showHidden: false, zoom: 72, collapsed: [] };
let tabs: Tab[] = [];
let activeTab = 0;
let places: Place[] = [];
let clip: { paths: string[]; cut: boolean } | null = null;
let dragPaths: string[] = [];
let canUndo = false;
let renaming = false;
let nextTabId = 1;
const folderSizes = new Map<string, { bytes: number; items: number }>();
const freeSpace = new Map<string, number | null>();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const tab = () => tabs[activeTab];
const pane = (t: Tab = tab()) => t.panes[t.active];
const mod = (e: KeyboardEvent | MouseEvent) => e.ctrlKey || e.metaKey;

function visible(p: Pane): Entry[] {
  const f = p.filter.trim().toLowerCase();
  return f ? p.entries.filter((e) => e.name.toLowerCase().includes(f)) : p.entries;
}

function selectedEntries(p: Pane): Entry[] {
  return p.entries.filter((e) => p.selected.has(e.path));
}

// ---------- session ----------

const SESSION_KEY = "shark.session.v1";
let saveTimer = 0;
function saveSession() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          settings,
          activeTab,
          tabs: tabs.map((t) => ({ active: t.active, paths: t.panes.map((p) => p.history.current) })),
        }),
      );
    } catch { /* storage unavailable: nothing to restore next time */ }
  }, 200);
}

function newPane(path: string): Pane {
  return { history: new History(path), entries: [], selected: new Set(), anchor: null, cursor: null, error: null, filter: "" };
}
function newTab(paths: string[], active = 0): Tab {
  return { id: nextTabId++, panes: paths.map(newPane), active: Math.min(active, paths.length - 1) };
}

// ---------- loading ----------

async function list(path: string): Promise<Entry[]> {
  return api.listDir(path, settings.showHidden, settings.sortKey, settings.ascending);
}

/** Reloads a pane. A folder that disappeared falls back to its nearest existing parent. */
async function reload(p: Pane): Promise<void> {
  let path = p.history.current;
  for (;;) {
    try {
      p.entries = await list(path);
      p.error = null;
      break;
    } catch (e) {
      const up = await api.parentDir(path);
      if (up === null || up === path) {
        p.entries = [];
        p.error = String(e);
        break;
      }
      path = up;
      p.history.current = up;
    }
  }
  const have = new Set(p.entries.map((e) => e.path));
  p.selected = new Set([...p.selected].filter((s) => have.has(s)));
  if (p.cursor && !have.has(p.cursor)) p.cursor = null;
}

async function go(p: Pane, path: string, select?: string): Promise<boolean> {
  try {
    const entries = await list(path);
    p.history.visit(path);
    p.entries = entries;
    p.error = null;
    p.filter = "";
    p.selected = new Set(select ? [select] : []);
    p.anchor = p.cursor = select ?? null;
    afterNavigate(p, select);
    return true;
  } catch (e) {
    toast(`Can't open ${baseName(path)}: ${e}`);
    return false;
  }
}

async function moveHistory(p: Pane, dir: "back" | "fwd") {
  const target = dir === "back" ? p.history.goBack() : p.history.goForward();
  if (target === null) return;
  await reload(p);
  p.selected.clear();
  p.anchor = p.cursor = null;
  afterNavigate(p);
}

function afterNavigate(p: Pane, select?: string) {
  p.filter = "";
  renderChrome();
  renderPane(tab().panes.indexOf(p));
  if (select) scrollToCursor(tab().panes.indexOf(p));
  syncWatch();
  saveSession();
}

async function up(p: Pane) {
  const parent = await api.parentDir(p.history.current);
  if (parent && parent !== p.history.current) await go(p, parent, p.history.current);
}

async function refreshAll(onlyTab: Tab = tab()) {
  if (renaming) return;
  await Promise.all(onlyTab.panes.map(reload));
  renderToolbar();
  renderPanes();
  renderStatus();
}

let watchKey = "";
function syncWatch() {
  const dirs = [...new Set(tab().panes.map((p) => p.history.current))];
  const key = dirs.join("\n");
  if (key !== watchKey) {
    watchKey = key;
    api.watchDirs(dirs).catch(() => {});
  }
}

// ---------- operations ----------

function summarize(r: { errors: string[] }, done: string): string {
  if (r.errors.length === 0) return done;
  const more = r.errors.length > 1 ? ` (and ${r.errors.length - 1} more)` : "";
  return `${r.errors[0]}${more}`;
}

function askConflicts(conflicts: string[], destName: string): Promise<Record<string, Resolution> | null> {
  const result: Record<string, Resolution> = {};
  const overlay = $("overlay");
  return new Promise((resolve) => {
    let i = 0;
    const close = (v: Record<string, Resolution> | null) => {
      overlay.hidden = true;
      overlay.innerHTML = "";
      resolve(v);
    };
    const show = () => {
      const name = baseName(conflicts[i]);
      overlay.hidden = false;
      overlay.innerHTML = `<div class="dialog" role="dialog" aria-modal="true">
        <h2>"${esc(name)}" already exists</h2>
        <p>A file or folder with this name is already in "${esc(destName)}". Replace sends the existing one to the Trash.</p>
        ${conflicts.length - i > 1 ? `<label class="apply"><input type="checkbox" id="apply-all"> Apply to all ${conflicts.length - i} remaining</label>` : ""}
        <div class="buttons">
          <button data-r="stop">Stop</button><button data-r="skip">Skip</button>
          <button data-r="keepboth">Keep Both</button><button data-r="replace" class="primary">Replace</button>
        </div></div>`;
      overlay.querySelector<HTMLButtonElement>('[data-r="replace"]')!.focus();
    };
    overlay.onclick = (ev) => {
      const r = (ev.target as HTMLElement).closest<HTMLElement>("[data-r]")?.dataset.r;
      if (!r) return;
      if (r === "stop") return close(null);
      const all = overlay.querySelector<HTMLInputElement>("#apply-all")?.checked;
      const end = all ? conflicts.length : i + 1;
      for (; i < end; i++) result[conflicts[i]] = r as Resolution;
      i < conflicts.length ? show() : close(result);
    };
    show();
  });
}

async function runTransfer(sources: string[], dest: string, kind: "copy" | "move") {
  const srcs = sources.filter((s) => s !== dest);
  if (srcs.length === 0) return;
  const conflicts = await api.checkConflicts(srcs, dest);
  const resolutions = conflicts.length ? await askConflicts(conflicts, baseName(dest)) : {};
  if (resolutions === null) return;
  const r = await api.transfer(srcs, dest, kind, resolutions);
  canUndo = r.can_undo;
  const verb = kind === "copy" ? "Copied" : "Moved";
  toast(summarize(r, `${verb} ${r.paths.length} item${r.paths.length === 1 ? "" : "s"}${r.skipped ? `, skipped ${r.skipped}` : ""}`), r.paths.length > 0);
  if (kind === "move") clip = null;
  await refreshAll();
  for (const p of tab().panes) {
    if (p.history.current === dest && r.paths.length) {
      p.selected = new Set(r.paths);
      p.anchor = p.cursor = r.paths[r.paths.length - 1];
    }
  }
  renderPanes();
  renderStatus();
}

async function trashSelection() {
  const p = pane();
  const paths = [...p.selected];
  if (paths.length === 0) return;
  const r = await api.trash(paths);
  canUndo = r.can_undo;
  toast(summarize(r, `Moved ${paths.length - r.errors.length} item${paths.length === 1 ? "" : "s"} to the Trash`), r.errors.length < paths.length);
  p.selected.clear();
  await refreshAll();
}

async function doUndo() {
  try {
    const r = await api.undo();
    canUndo = r.can_undo;
    toast(`Undid: ${r.label}`);
  } catch (e) {
    toast(String(e), false);
  }
  await refreshAll();
}

async function duplicateSelection() {
  const p = pane();
  const paths = [...p.selected];
  if (!paths.length) return;
  const r = await api.duplicate(paths);
  canUndo = r.can_undo;
  if (r.errors.length) toast(summarize(r, ""));
  await refreshAll();
  p.selected = new Set(r.paths);
  renderPanes();
  renderStatus();
}

async function createFolder() {
  const p = pane();
  try {
    const r = await api.newFolder(p.history.current);
    canUndo = r.can_undo;
    await refreshAll();
    p.selected = new Set(r.paths);
    p.anchor = p.cursor = r.paths[0];
    renderPanes();
    startRename(r.paths[0]);
  } catch (e) {
    toast(String(e));
  }
}

function copySelection(cut: boolean) {
  const paths = [...pane().selected];
  if (!paths.length) return;
  clip = { paths, cut };
  renderPanes();
  toast(`${cut ? "Cut" : "Copied"} ${paths.length} item${paths.length === 1 ? "" : "s"}`, false);
}

async function paste() {
  if (!clip) return;
  const { paths, cut } = clip;
  await runTransfer(paths, pane().history.current, cut ? "move" : "copy");
}

function openEntry(p: Pane, e: Entry) {
  if (e.kind === "folder") void go(p, e.path);
  else api.openPath(e.path).catch((err) => toast(`Can't open ${e.name}: ${err}`));
}

function openSelection() {
  const p = pane();
  const sel = selectedEntries(p);
  if (sel.length === 1) return openEntry(p, sel[0]);
  sel.filter((e) => e.kind === "file").forEach((e) => openEntry(p, e));
}

function startRename(path: string) {
  const idx = tab().active;
  const row = document.querySelector<HTMLElement>(`.pane[data-pane="${idx}"] [data-path="${CSS.escape(path)}"]`);
  const cell = row?.querySelector<HTMLElement>(".name");
  const entry = pane().entries.find((e) => e.path === path);
  if (!row || !cell || !entry) return;
  renaming = true;
  const input = document.createElement("input");
  input.className = "rename";
  input.value = entry.name;
  cell.replaceChildren(input);
  input.focus();
  input.setSelectionRange(0, stemLength(entry.name, entry.kind === "folder"));
  let finished = false;
  const finish = async (commit: boolean) => {
    if (finished) return;
    finished = true;
    renaming = false;
    const name = input.value.trim();
    if (commit && name && name !== entry.name) {
      try {
        const r = await api.rename(path, name);
        canUndo = r.can_undo;
        const p = pane();
        await refreshAll();
        p.selected = new Set(r.paths);
        p.anchor = p.cursor = r.paths[0];
      } catch (e) {
        toast(String(e));
      }
    }
    await refreshAll();
    focusListing();
  };
  input.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Enter") void finish(true);
    if (ev.key === "Escape") void finish(false);
  });
  input.addEventListener("blur", () => void finish(true));
  input.addEventListener("click", (ev) => ev.stopPropagation());
  input.addEventListener("dblclick", (ev) => ev.stopPropagation());
}

// ---------- rendering ----------

function toast(message: string, withUndo = false) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  if (withUndo && canUndo) {
    const b = document.createElement("button");
    b.textContent = "Undo";
    b.onclick = () => {
      el.remove();
      void doUndo();
    };
    el.append(b);
  }
  $("toasts").append(el);
  setTimeout(() => el.remove(), withUndo ? 7000 : 4500);
}

function tabTitle(t: Tab): string {
  return t.panes.map((p) => baseName(p.history.current)).join(" | ");
}

function renderTabs() {
  $("tabbar").innerHTML =
    `<div class="tabs">${tabs
      .map(
        (t, i) =>
          `<div class="tab${i === activeTab ? " active" : ""}" data-tab="${i}" title="${esc(pane(t).history.current)}"><span>${esc(tabTitle(t))}</span>${
            tabs.length > 1 ? `<button class="x" data-close="${i}" aria-label="Close tab">${ui("close", "xi")}</button>` : ""
          }</div>`,
      )
      .join("")}</div><button id="new-tab" aria-label="New tab" title="New tab (Ctrl+T)">+</button>`;
}

const searchEl = document.createElement("label");
searchEl.className = "capsule search";
searchEl.innerHTML = `${ui("search", "sico")}<input class="search-input" placeholder="Search" aria-label="Filter this folder" spellcheck="false">`;

function renderToolbar() {
  if (document.querySelector(".pathinput")) return; // don't wipe a path being typed
  const p = pane();
  const h = p.history;
  const btn = (id: string, icon: Parameters<typeof ui>[0], title: string, opts: { on?: boolean; off?: boolean } = {}) =>
    `<button id="${id}" class="${opts.on ? "on" : ""}" title="${title}" aria-label="${title}" ${opts.off ? "disabled" : ""}>${ui(icon)}</button>`;
  const group = (cap: string, body: string, cls = "") => `<div class="tbg ${cls}">${body}<span class="cap">${cap}</span></div>`;
  $("toolbar").innerHTML =
    group("Navigation", `<div class="capsule">${btn("nav-back", "back", "Back (Alt+←)", { off: !h.canBack() })}${btn("nav-fwd", "fwd", "Forward (Alt+→)", { off: !h.canForward() })}${btn("nav-up", "up", "Up (Alt+↑)")}</div>`) +
    group("Location", `<nav id="crumbs" class="capsule crumbs" title="Click to type a path (Ctrl+L)">${crumbsHtml(h.current)}</nav>`, "grow") +
    group(
      "Sort",
      `<div class="capsule"><select id="tb-sort" aria-label="Sort by">${(["name", "modified", "size", "kind"] as SortKey[])
        .map((k) => `<option value="${k}"${settings.sortKey === k ? " selected" : ""}>${k === "modified" ? "Date Modified" : k[0].toUpperCase() + k.slice(1)}</option>`)
        .join("")}</select>${btn("tb-order", "sort", settings.ascending ? "Ascending (click to reverse)" : "Descending (click to reverse)")}</div>`,
    ) +
    group("View", `<div class="capsule">${btn("tb-list", "list", "List view", { on: settings.view === "list" })}${btn("tb-icons", "grid", "Icon view", { on: settings.view === "icons" })}</div>`) +
    group("Hidden", `<div class="capsule">${btn("tb-hidden", "eye", "Show hidden files (Ctrl+H)", { on: settings.showHidden })}</div>`) +
    group("New Folder", `<div class="capsule">${btn("tb-folder", "newfolder", "New folder (Ctrl+Shift+N)")}</div>`) +
    group("Undo", `<div class="capsule">${btn("tb-undo", "undo", "Undo (Ctrl+Z)", { off: !canUndo })}</div>`) +
    group("Split", `<div class="capsule">${btn("tb-split", "split", "Two panes (Ctrl+\\)", { on: tab().panes.length > 1 })}</div>`) +
    group("Search", `<span id="search-slot"></span>`, "searchg");
  $("search-slot").replaceWith(searchEl);
  const input = searchEl.querySelector("input")!;
  if (document.activeElement !== input) input.value = p.filter;
  scrollCrumbs();
}

function renderSidebar() {
  const current = pane().history.current;
  const groups: [string, Place[]][] = [
    ["Favorites", places.filter((p) => p.kind === "folder")],
    ["Locations", places.filter((p) => p.kind !== "folder")],
  ];
  $("sidebar").innerHTML = groups
    .filter(([, list]) => list.length)
    .map(([title, list]) => {
      const closed = settings.collapsed.includes(title);
      return (
        `<button class="shead" data-section="${title}" aria-expanded="${!closed}">${title}<span class="chev${closed ? " closed" : ""}">${ui("chevron", "chevi")}</span></button>` +
        (closed
          ? ""
          : list
              .map(
                (pl) =>
                  `<div class="place${pl.path === current ? " active" : ""}" data-place="${esc(pl.path)}" title="${esc(pl.path)}">${placeIcon(pl.name, pl.kind)}<span>${esc(pl.name)}</span></div>`,
              )
              .join(""))
      );
    })
    .join("");
}

function renderChrome() {
  renderTabs();
  renderToolbar();
  renderSidebar();
}

function buildStatusShell() {
  $("status").innerHTML = `<span id="status-text"></span><label id="zoom-box" hidden>${ui("picture", "zi")}<input type="range" id="zoom" min="48" max="192" step="4" aria-label="Icon size"></label>`;
  const z = $<HTMLInputElement>("zoom");
  z.addEventListener("input", () => setZoom(+z.value));
}

function setZoom(v: number) {
  settings.zoom = Math.max(48, Math.min(192, Math.round(v)));
  $("panes").style.setProperty("--zoom", `${settings.zoom}px`);
  $<HTMLInputElement>("zoom").value = String(settings.zoom);
  saveSession();
}

function crumbsHtml(path: string): string {
  return breadcrumbs(path)
    .map((c, i, all) => `<button class="crumb${i === all.length - 1 ? " last" : ""}" data-crumb="${esc(c.path)}">${esc(c.label)}</button>`)
    .join('<span class="sep"></span>');
}

function rowsHtml(p: Pane): string {
  const items = visible(p);
  if (p.error) return `<div class="empty">${esc(p.error)}</div>`;
  if (items.length === 0) return `<div class="empty">${p.filter ? "No matches" : "This Folder is Empty"}</div>`;
  const cut = new Set(clip?.cut ? clip.paths : []);
  return items
    .map((e) => {
      const cls = `item${p.selected.has(e.path) ? " selected" : ""}${p.cursor === e.path ? " cursor" : ""}${cut.has(e.path) ? " cut" : ""}${e.hidden ? " hidden-file" : ""}`;
      const attrs = `class="${cls}" data-path="${esc(e.path)}" data-kind="${e.kind}" draggable="true"`;
      if (settings.view === "icons") return `<div ${attrs}>${iconFor(e)}<div class="name"><span>${esc(e.name)}</span></div></div>`;
      return `<div ${attrs}><div class="name">${listIcon(e)}<span>${esc(e.name)}</span></div><div class="col size">${
        e.kind === "folder" ? "––" : formatSize(e.size)
      }</div><div class="col mod">${formatDate(e.modified)}</div><div class="col kind">${kindLabel(e)}</div></div>`;
    })
    .join("");
}

function headerHtml(): string {
  if (settings.view !== "list") return "";
  const h = (key: SortKey, label: string, cls: string) =>
    `<div class="${cls}${settings.sortKey === key ? " sorted" : ""}" data-sort="${key}"><span>${label}</span>${
      settings.sortKey === key ? `<i class="dir">${ui(settings.ascending ? "up" : "chevron", "chevi")}</i>` : ""
    }</div>`;
  return `<div class="colhead">${h("name", "Name", "name")}${h("size", "Size", "col size")}${h("modified", "Date Modified", "col mod")}${h("kind", "Kind", "col kind")}</div>`;
}

/** Long paths scroll so the current folder (the end) stays visible. */
function scrollCrumbs() {
  const c = document.getElementById("crumbs");
  if (c) c.scrollLeft = c.scrollWidth;
}

function renderPanes() {
  const t = tab();
  const host = $("panes");
  host.className = t.panes.length > 1 ? "split" : "";
  host.style.setProperty("--zoom", `${settings.zoom}px`);
  host.innerHTML = t.panes
    .map(
      (p, i) => `<section class="pane${i === t.active ? " active" : ""}" data-pane="${i}">
        ${
          t.panes.length > 1
            ? `<header class="pane-head"><span class="dot"></span><span class="pname">${esc(baseName(p.history.current))}</span><span class="side">${i === 0 ? "Left Pane" : "Right Pane"}</span><button data-close-pane="${i}" aria-label="Close pane">${ui("close", "xi")}</button></header>`
            : ""
        }
        <div class="listing ${settings.view}" tabindex="0">${headerHtml()}<div class="rows">${rowsHtml(p)}</div></div>
      </section>`,
    )
    .join("");
}

function renderPane(i: number) {
  // Rebuilds one pane's rows in place; the toolbar keeps focus in the search box.
  const p = tab().panes[i];
  const el = document.querySelector<HTMLElement>(`.pane[data-pane="${i}"]`);
  if (!el) return renderPanes();
  el.querySelector(".rows")!.innerHTML = rowsHtml(p);
  const name = el.querySelector(".pname");
  if (name) name.textContent = baseName(p.history.current);
  renderStatus();
}

function syncSelection(i: number) {
  const p = tab().panes[i];
  document.querySelectorAll<HTMLElement>(`.pane[data-pane="${i}"] .item`).forEach((el) => {
    el.classList.toggle("selected", p.selected.has(el.dataset.path!));
    el.classList.toggle("cursor", p.cursor === el.dataset.path);
  });
  renderStatus();
}

function renderStatus() {
  const p = pane();
  const items = visible(p);
  const sel = selectedEntries(p);
  let bytes: number | null = sel.filter((e) => e.kind === "file").reduce((n, e) => n + e.size, 0);
  if (sel.length === 1 && sel[0].kind === "folder") {
    const s = folderSizes.get(sel[0].path);
    bytes = s ? s.bytes : null;
    if (!s) void measure(sel[0].path);
  }
  const path = p.history.current;
  if (!freeSpace.has(path)) {
    freeSpace.set(path, null);
    void api.diskFree(path).then((n) => {
      freeSpace.set(path, n);
      if (pane().history.current === path) renderStatus();
    });
  }
  $("status-text").textContent = statusLine(items.length, sel.length, bytes, freeSpace.get(path) ?? null);
  $("zoom-box").hidden = settings.view !== "icons";
}

async function measure(path: string) {
  const r = await api.folderSize(path);
  folderSizes.set(path, r);
  if (pane().selected.size === 1 && pane().selected.has(path)) renderStatus();
}

function scrollToCursor(i: number) {
  const p = tab().panes[i];
  if (!p.cursor) return;
  document
    .querySelector<HTMLElement>(`.pane[data-pane="${i}"] [data-path="${CSS.escape(p.cursor)}"]`)
    ?.scrollIntoView({ block: "nearest" });
}

function focusListing() {
  document.querySelector<HTMLElement>(`.pane[data-pane="${tab().active}"] .listing`)?.focus({ preventScroll: true });
}

// ---------- selection ----------

function select(p: Pane, paths: string[], cursor: string | null, anchor?: string | null) {
  p.selected = new Set(paths);
  p.cursor = cursor;
  if (anchor !== undefined) p.anchor = anchor;
}

function clickItem(p: Pane, e: Entry, ev: MouseEvent, phase: "down" | "click") {
  const items = visible(p);
  if (phase === "down") {
    if (ev.shiftKey) {
      const range = rangeBetween(items, p.anchor, e.path);
      const base = mod(ev) ? [...p.selected] : [];
      select(p, [...base, ...range], e.path);
    } else if (mod(ev)) {
      const next = new Set(p.selected);
      next.has(e.path) ? next.delete(e.path) : next.add(e.path);
      select(p, [...next], e.path, e.path);
    } else if (!p.selected.has(e.path)) select(p, [e.path], e.path, e.path);
    else p.cursor = e.path;
  } else if (!ev.shiftKey && !mod(ev) && p.selected.size > 1) {
    // A plain click inside a multi-selection narrows it (after the chance to drag them).
    select(p, [e.path], e.path, e.path);
  }
}

function columns(): number {
  const rows = document.querySelectorAll<HTMLElement>(`.pane[data-pane="${tab().active}"] .item`);
  if (settings.view !== "icons" || rows.length === 0) return 1;
  const top = rows[0].offsetTop;
  let n = 0;
  while (n < rows.length && rows[n].offsetTop === top) n++;
  return Math.max(1, n);
}

let typeBuffer = "";
let typeTimer = 0;

function onKey(ev: KeyboardEvent) {
  const target = ev.target as HTMLElement;
  if (!$("overlay").hidden) {
    if (ev.key === "Escape") $("overlay").querySelector<HTMLButtonElement>('[data-r="stop"]')?.click();
    return;
  }
  closeMenu();
  const typing = target.tagName === "INPUT" || target.tagName === "SELECT";
  if (typing) {
    if (ev.key === "Escape" && target.classList.contains("search-input")) {
      (target as HTMLInputElement).value = "";
      pane().filter = "";
      renderPane(tab().active);
      focusListing();
    }
    if (ev.key === "Enter" && target.classList.contains("search-input")) focusListing();
    return;
  }
  const p = pane();
  const items = visible(p);
  const k = ev.key;
  const m = mod(ev);
  const swallow = () => ev.preventDefault();

  if (m && !ev.shiftKey && !ev.altKey) {
    const lower = k.toLowerCase();
    const handlers: Record<string, () => void> = {
      a: () => { select(p, items.map((e) => e.path), p.cursor, p.anchor); syncSelection(tab().active); },
      c: () => copySelection(false),
      x: () => copySelection(true),
      v: () => void paste(),
      d: () => void duplicateSelection(),
      z: () => void doUndo(),
      t: () => addTab(p.history.current),
      w: () => closeTab(activeTab),
      l: () => editPath(),
      f: () => searchEl.querySelector("input")!.focus(),
      "=": () => setZoom(settings.zoom + 12),
      "+": () => setZoom(settings.zoom + 12),
      "-": () => setZoom(settings.zoom - 12),
      "0": () => setZoom(72),
      h: () => toggleHidden(),
      "\\": () => toggleSplit(),
      Tab: () => switchTab((activeTab + 1) % tabs.length),
      Backspace: () => void trashSelection(),
      " ": () => {
        if (!p.cursor) return;
        const next = new Set(p.selected);
        next.has(p.cursor) ? next.delete(p.cursor) : next.add(p.cursor);
        select(p, [...next], p.cursor, p.cursor);
        syncSelection(tab().active);
      },
    };
    const key = k === "Tab" || k === "Backspace" ? k : lower;
    if (handlers[key]) { swallow(); return handlers[key](); }
  }
  if (m && ev.shiftKey && k.toLowerCase() === "n") { swallow(); return void createFolder(); }
  if (m && ev.shiftKey && k === "Tab") { swallow(); return switchTab((activeTab - 1 + tabs.length) % tabs.length); }

  if (ev.altKey) {
    if (k === "ArrowLeft") { swallow(); return void moveHistory(p, "back"); }
    if (k === "ArrowRight") { swallow(); return void moveHistory(p, "fwd"); }
    if (k === "ArrowUp") { swallow(); return void up(p); }
    return;
  }
  switch (k) {
    case "ArrowUp": case "ArrowDown": case "ArrowLeft": case "ArrowRight": case "Home": case "End": {
      swallow();
      const cur = items.findIndex((e) => e.path === p.cursor);
      const idx = navigate(k as NavKey, cur, items.length, columns());
      if (idx < 0) return;
      const target = items[idx];
      if (ev.shiftKey) select(p, rangeBetween(items, p.anchor ?? p.cursor ?? target.path, target.path), target.path, p.anchor ?? p.cursor ?? target.path);
      else if (m) p.cursor = target.path;
      else select(p, [target.path], target.path, target.path);
      syncSelection(tab().active);
      return scrollToCursor(tab().active);
    }
    case "Enter": swallow(); return openSelection();
    case "F2": {
      swallow();
      if (p.selected.size === 1) startRename([...p.selected][0]);
      return;
    }
    case "F5": swallow(); return void refreshAll();
    case "Delete": swallow(); return void trashSelection();
    case "Backspace": swallow(); return void up(p);
    case "Tab":
      if (tab().panes.length > 1) {
        swallow();
        setActivePane((tab().active + 1) % tab().panes.length);
      }
      return;
    case "Escape":
      if (p.selected.size) { select(p, [], null, null); syncSelection(tab().active); }
      return;
  }
  if (k.length === 1 && !m) {
    clearTimeout(typeTimer);
    typeTimer = window.setTimeout(() => (typeBuffer = ""), 800);
    typeBuffer += k;
    const from = items.findIndex((e) => e.path === p.cursor);
    const idx = typeSelect(items, typeBuffer, from);
    if (idx >= 0) {
      swallow();
      select(p, [items[idx].path], items[idx].path, items[idx].path);
      syncSelection(tab().active);
      scrollToCursor(tab().active);
    }
  }
}

// ---------- tabs, panes, settings ----------

function setActivePane(i: number) {
  if (tab().active === i) return;
  tab().active = i;
  document.querySelectorAll(".pane").forEach((el, n) => el.classList.toggle("active", n === i));
  renderToolbar();
  renderSidebar();
  renderStatus();
  renderTabs();
}

function switchTab(i: number) {
  activeTab = i;
  renderChrome();
  renderPanes();
  renderStatus();
  syncWatch();
  void refreshAll();
  saveSession();
}

function addTab(path: string) {
  const t = newTab([path]);
  tabs.splice(activeTab + 1, 0, t);
  activeTab += 1;
  void reload(t.panes[0]).then(() => switchTab(activeTab));
}

function closeTab(i: number) {
  if (tabs.length === 1) return;
  tabs.splice(i, 1);
  activeTab = Math.min(activeTab, tabs.length - 1);
  switchTab(activeTab);
}

function toggleSplit() {
  const t = tab();
  if (t.panes.length > 1) {
    t.panes = [t.panes[t.active]];
    t.active = 0;
  } else {
    const copy = newPane(pane().history.current);
    copy.entries = pane().entries;
    t.panes.push(copy);
    t.active = 1;
  }
  renderChrome();
  renderPanes();
  renderStatus();
  syncWatch();
  saveSession();
}

function toggleHidden() {
  settings.showHidden = !settings.showHidden;
  void applySettings();
}

async function applySettings() {
  renderToolbar();
  await Promise.all(tabs.flatMap((t) => t.panes).map(reload));
  renderPanes();
  renderStatus();
  saveSession();
}

function editPath() {
  const nav = document.getElementById("crumbs");
  const p = pane();
  if (!nav || nav.querySelector("input")) return;
  const input = document.createElement("input");
  input.className = "pathinput";
  input.value = p.history.current;
  nav.replaceChildren(input);
  input.focus();
  input.select();
  let closed = false;
  const restore = () => {
    if (closed) return;
    closed = true;
    input.remove();
    renderToolbar();
  };
  input.addEventListener("keydown", async (ev) => {
    ev.stopPropagation();
    if (ev.key === "Enter") {
      const ok = await go(p, input.value.trim());
      if (!ok) input.focus();
      else {
        restore();
        focusListing();
      }
    }
    if (ev.key === "Escape") restore();
  });
  input.addEventListener("blur", restore);
}

// ---------- context menu ----------

interface MenuItem {
  label: string;
  run?: () => void;
  disabled?: boolean;
  hint?: string;
}

function closeMenu() {
  document.getElementById("menu")?.remove();
}

function showMenu(x: number, y: number, items: (MenuItem | "-")[]) {
  closeMenu();
  const menu = document.createElement("div");
  menu.id = "menu";
  menu.setAttribute("role", "menu");
  items.forEach((it) => {
    if (it === "-") return menu.append(Object.assign(document.createElement("hr")));
    const b = document.createElement("button");
    b.setAttribute("role", "menuitem");
    b.disabled = !!it.disabled;
    b.innerHTML = `<span>${esc(it.label)}</span><kbd>${esc(it.hint ?? "")}</kbd>`;
    b.onclick = () => {
      closeMenu();
      it.run?.();
    };
    menu.append(b);
  });
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - r.width - 4)}px`;
  menu.style.top = `${Math.min(y, innerHeight - r.height - 4)}px`;
}

function contextMenu(ev: MouseEvent, itemEl: HTMLElement | null) {
  ev.preventDefault();
  const p = pane();
  const hasClip = !!clip;
  if (itemEl) {
    const e = p.entries.find((x) => x.path === itemEl.dataset.path)!;
    if (!p.selected.has(e.path)) {
      select(p, [e.path], e.path, e.path);
      syncSelection(tab().active);
    }
    const one = p.selected.size === 1;
    showMenu(ev.clientX, ev.clientY, [
      { label: "Open", run: openSelection, hint: "Enter" },
      ...(one && e.kind === "folder" ? [{ label: "Open in New Tab", run: () => addTab(e.path) }] : []),
      "-",
      { label: "Cut", run: () => copySelection(true), hint: "Ctrl+X" },
      { label: "Copy", run: () => copySelection(false), hint: "Ctrl+C" },
      { label: "Paste into Folder", run: () => e.kind === "folder" && clip && void runTransfer(clip.paths, e.path, clip.cut ? "move" : "copy"), disabled: !(hasClip && one && e.kind === "folder") },
      { label: "Duplicate", run: () => void duplicateSelection(), hint: "Ctrl+D" },
      "-",
      { label: "Rename", run: () => startRename(e.path), disabled: !one, hint: "F2" },
      { label: "Move to Trash", run: () => void trashSelection(), hint: "Del" },
    ]);
  } else {
    showMenu(ev.clientX, ev.clientY, [
      { label: "New Folder", run: () => void createFolder(), hint: "Ctrl+Shift+N" },
      { label: "Paste", run: () => void paste(), disabled: !hasClip, hint: "Ctrl+V" },
      "-",
      { label: "Select All", run: () => { select(p, visible(p).map((e) => e.path), p.cursor, p.anchor); syncSelection(tab().active); }, hint: "Ctrl+A" },
      { label: settings.showHidden ? "Hide Hidden Files" : "Show Hidden Files", run: toggleHidden, hint: "Ctrl+H" },
      { label: "Refresh", run: () => void refreshAll(), hint: "F5" },
    ]);
  }
}

// ---------- events ----------

function dropTarget(el: HTMLElement | null): { el: HTMLElement; path: string } | null {
  const folder = el?.closest<HTMLElement>('.item[data-kind="folder"]');
  if (folder) return { el: folder, path: folder.dataset.path! };
  const place = el?.closest<HTMLElement>(".place");
  if (place) return { el: place, path: place.dataset.place! };
  const t = el?.closest<HTMLElement>(".tab");
  if (t) return { el: t, path: pane(tabs[+t.dataset.tab!]).history.current };
  const listing = el?.closest<HTMLElement>(".pane");
  if (listing) return { el: listing, path: tab().panes[+listing.dataset.pane!].history.current };
  return null;
}

function clearDrop() {
  document.querySelectorAll(".drop").forEach((e) => e.classList.remove("drop"));
}

function wire() {
  document.addEventListener("keydown", onKey);
  document.addEventListener("mousedown", (ev) => {
    if (!(ev.target as HTMLElement).closest("#menu")) closeMenu();
  });
  window.addEventListener("blur", closeMenu);

  $("tabbar").addEventListener("mousedown", (ev) => {
    const t = ev.target as HTMLElement;
    const close = t.closest<HTMLElement>("[data-close]");
    const tabEl = t.closest<HTMLElement>("[data-tab]");
    if (close) return closeTab(+close.dataset.close!);
    if (t.closest("#new-tab")) return addTab(pane().history.current);
    if (tabEl) ev.button === 1 ? closeTab(+tabEl.dataset.tab!) : switchTab(+tabEl.dataset.tab!);
  });

  $("tabbar").addEventListener("dblclick", (ev) => {
    if (!(ev.target as HTMLElement).closest("[data-tab], button")) addTab(pane().history.current);
  });
  $("tabbar").addEventListener("wheel", (ev) => {
    if (tabs.length < 2) return;
    ev.preventDefault();
    const step = (ev.deltaY || ev.deltaX) > 0 ? 1 : -1;
    switchTab((activeTab + step + tabs.length) % tabs.length);
  }, { passive: false });

  $("sidebar").addEventListener("mousedown", (ev) => {
    const t = ev.target as HTMLElement;
    const head = t.closest<HTMLElement>("[data-section]");
    if (head) {
      const name = head.dataset.section!;
      const i = settings.collapsed.indexOf(name);
      if (i >= 0) settings.collapsed.splice(i, 1);
      else settings.collapsed.push(name);
      renderSidebar();
      return saveSession();
    }
    const el = t.closest<HTMLElement>("[data-place]");
    if (!el) return;
    if (ev.button === 1) return addTab(el.dataset.place!);
    void go(pane(), el.dataset.place!);
  });

  $("toolbar").addEventListener("click", (ev) => {
    const el = ev.target as HTMLElement;
    const crumb = el.closest<HTMLElement>("[data-crumb]");
    if (crumb) return void go(pane(), crumb.dataset.crumb!);
    if (el.closest("#crumbs") && !el.closest("input")) return editPath();
    const id = el.closest("button")?.id;
    const actions: Record<string, () => void> = {
      "nav-back": () => void moveHistory(pane(), "back"),
      "nav-fwd": () => void moveHistory(pane(), "fwd"),
      "nav-up": () => void up(pane()),
      "tb-undo": () => void doUndo(),
      "tb-folder": () => void createFolder(),
      "tb-order": () => { settings.ascending = !settings.ascending; void applySettings(); },
      "tb-list": () => { settings.view = "list"; void applySettings(); },
      "tb-icons": () => { settings.view = "icons"; void applySettings(); },
      "tb-hidden": toggleHidden,
      "tb-split": toggleSplit,
    };
    if (id && actions[id]) actions[id]();
  });
  $("toolbar").addEventListener("input", (ev) => {
    const el = ev.target as HTMLInputElement;
    if (!el.classList.contains("search-input")) return;
    const p = pane();
    p.filter = el.value;
    p.selected.clear();
    p.cursor = p.anchor = null;
    renderPane(tab().active);
  });
  $("toolbar").addEventListener("change", (ev) => {
    const t = ev.target as HTMLSelectElement;
    if (t.id === "tb-sort") {
      settings.sortKey = t.value as SortKey;
      void applySettings();
    }
  });

  const panes = $("panes");
  const paneOf = (el: HTMLElement) => el.closest<HTMLElement>(".pane");
  const entryOf = (el: HTMLElement) => {
    const item = el.closest<HTMLElement>(".item");
    const pn = paneOf(el);
    return item && pn ? { item, entry: tab().panes[+pn.dataset.pane!].entries.find((e) => e.path === item.dataset.path) } : null;
  };

  panes.addEventListener("mousedown", (ev) => {
    const el = ev.target as HTMLElement;
    const pn = paneOf(el);
    if (!pn) return;
    setActivePane(+pn.dataset.pane!);
    const p = pane();
    if (el.closest(".rename, .pathinput")) return;
    const hit = entryOf(el);
    if (hit?.entry) {
      if (ev.button === 2 && p.selected.has(hit.entry.path)) return;
      if (ev.button === 1 && hit.entry.kind === "folder") return void addTab(hit.entry.path);
      if (ev.button === 0 || ev.button === 2) clickItem(p, hit.entry, ev, "down");
      syncSelection(tab().active);
      focusListing();
    } else if (el.closest(".listing") && !el.closest(".colhead") && ev.button === 0) {
      if (!ev.shiftKey && !mod(ev)) select(p, [], null, null);
      syncSelection(tab().active);
    }
  });

  panes.addEventListener("click", (ev) => {
    const el = ev.target as HTMLElement;
    const pn = paneOf(el);
    if (!pn) return;
    const p = tab().panes[+pn.dataset.pane!];
    const closePane = el.closest<HTMLElement>("[data-close-pane]");
    if (closePane) {
      const keep = 1 - +closePane.dataset.closePane!;
      tab().panes = [tab().panes[keep]];
      tab().active = 0;
      renderChrome();
      renderPanes();
      renderStatus();
      syncWatch();
      return saveSession();
    }
    const sort = el.closest<HTMLElement>("[data-sort]")?.dataset.sort as SortKey | undefined;
    if (sort) {
      if (settings.sortKey === sort) settings.ascending = !settings.ascending;
      else Object.assign(settings, { sortKey: sort, ascending: true });
      return void applySettings();
    }
    const hit = entryOf(el);
    if (hit?.entry && ev.button === 0 && !el.closest(".rename")) {
      clickItem(p, hit.entry, ev, "click");
      syncSelection(tab().active);
    }
  });

  panes.addEventListener("dblclick", (ev) => {
    const el = ev.target as HTMLElement;
    const hit = entryOf(el);
    if (hit?.entry && !el.closest(".rename")) return openEntry(pane(), hit.entry);
    // Mouse zone: double-click on empty folder space goes up a level.
    if (!hit && el.closest(".listing") && !el.closest(".colhead")) void up(pane());
  });

  panes.addEventListener("wheel", (ev) => {
    if (mod(ev) && settings.view === "icons") {
      ev.preventDefault();
      setZoom(settings.zoom - Math.sign(ev.deltaY) * 8);
    }
  }, { passive: false });

  panes.addEventListener("contextmenu", (ev) => {
    const el = ev.target as HTMLElement;
    if (!paneOf(el) || el.closest("input")) return;
    contextMenu(ev, el.closest<HTMLElement>(".item"));
  });

  // Drag and drop between folders, panes, tabs and the sidebar. Move by default, Ctrl copies.
  document.addEventListener("dragstart", (ev) => {
    const hit = entryOf(ev.target as HTMLElement);
    if (!hit?.entry || !ev.dataTransfer) return;
    const p = pane();
    if (!p.selected.has(hit.entry.path)) {
      select(p, [hit.entry.path], hit.entry.path, hit.entry.path);
      syncSelection(tab().active);
    }
    dragPaths = [...p.selected];
    ev.dataTransfer.setData("text/plain", dragPaths.join("\n"));
    ev.dataTransfer.effectAllowed = "copyMove";
  });
  document.addEventListener("dragover", (ev) => {
    if (!dragPaths.length) return;
    const t = dropTarget(ev.target as HTMLElement);
    clearDrop();
    if (!t || dragPaths.includes(t.path)) return;
    ev.preventDefault();
    ev.dataTransfer!.dropEffect = mod(ev) ? "copy" : "move";
    t.el.classList.add("drop");
  });
  document.addEventListener("dragleave", (ev) => {
    if (!(ev.relatedTarget as HTMLElement | null)?.closest) clearDrop();
  });
  document.addEventListener("drop", (ev) => {
    if (!dragPaths.length) return;
    const t = dropTarget(ev.target as HTMLElement);
    clearDrop();
    if (!t || dragPaths.includes(t.path)) return;
    ev.preventDefault();
    const sources = dragPaths;
    dragPaths = [];
    void runTransfer(sources, t.path, mod(ev) ? "copy" : "move");
  });
  document.addEventListener("dragend", () => {
    dragPaths = [];
    clearDrop();
  });

  let refreshTimer = 0;
  void onDirChanged(() => {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => void refreshAll(), 80);
  });
}

export async function start() {
  const home = await api.homeDir();
  places = await api.places();
  let restored: { settings?: Partial<Settings>; activeTab?: number; tabs?: { active: number; paths: string[] }[] } = {};
  try {
    restored = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "{}");
  } catch { /* corrupt session: start fresh */ }
  Object.assign(settings, restored.settings ?? {});
  const saved = (restored.tabs ?? []).filter((t) => t.paths?.length);
  tabs = saved.length ? saved.map((t) => newTab(t.paths.slice(0, 2), t.active)) : [newTab([home])];
  activeTab = Math.min(restored.activeTab ?? 0, tabs.length - 1);
  await Promise.all(tabs.flatMap((t) => t.panes).map(reload));
  buildStatusShell();
  $<HTMLInputElement>("zoom").value = String(settings.zoom);
  renderChrome();
  renderPanes();
  renderStatus();
  wire();
  syncWatch();
  focusListing();
}
