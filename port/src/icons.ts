import type { Entry } from "./logic";

const FOLDER = `<svg viewBox="0 0 32 32" class="ico"><path d="M2 7a3 3 0 0 1 3-3h7.500l3 3H27a3 3 0 0 1 3 3v15a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z" fill="var(--folder-back)"/><path d="M2 12.500a3 3 0 0 1 3-3h22a3 3 0 0 1 3 3V25a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z" fill="var(--folder)"/></svg>`;

const CATEGORIES: Record<string, string[]> = {
  "#e5484d": ["pdf"],
  "#30a46c": ["xls", "xlsx", "csv", "ods"],
  "#3e63dd": ["doc", "docx", "odt", "rtf", "txt", "md"],
  "#f76b15": ["ppt", "pptx", "odp"],
  "#8e4ec6": ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "heic", "avif"],
  "#ab6400": ["zip", "tar", "gz", "7z", "rar", "xz", "bz2", "deb", "appimage", "exe", "msi"],
  "#0091ff": ["js", "ts", "rs", "py", "go", "java", "c", "h", "cpp", "json", "html", "css", "sh", "swift", "toml", "yml", "yaml"],
  "#d6409f": ["mp3", "wav", "flac", "ogg", "m4a", "mp4", "mkv", "mov", "webm", "avi"],
};

function colorFor(ext: string): string {
  for (const [color, exts] of Object.entries(CATEGORIES)) if (exts.includes(ext)) return color;
  return "#8b8d98";
}

export function iconFor(e: Entry): string {
  if (e.kind === "folder") return FOLDER;
  const label = e.ext.slice(0, 4).toUpperCase().replace(/[<&>]/g, "");
  return `<svg viewBox="0 0 32 32" class="ico"><path d="M7 3h13l6 6v18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="var(--page)" stroke="var(--page-line)"/><path d="M20 3v4a2 2 0 0 0 2 2h4" fill="none" stroke="var(--page-line)"/>${
    label ? `<rect x="5" y="17" width="21" height="8" rx="1.5" fill="${colorFor(e.ext)}"/><text x="15.5" y="23.3" font-size="5.6" font-weight="700" text-anchor="middle" fill="#fff" font-family="system-ui,sans-serif">${label}</text>` : ""
  }</svg>`;
}

const line = (body: string, cls = "pico") =>
  `<svg viewBox="0 0 24 24" class="${cls}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const G = {
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  desktop: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  doc: '<path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v5h5"/>',
  download: '<circle cx="12" cy="12" r="9"/><path d="M12 7v7M8.500 11.500L12 15l3.500-3.500"/>',
  picture: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.500"/><path d="M4 18l5-5 4 4 3-3 4 4"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="16" r="2"/>',
  video: '<rect x="3" y="6" width="14" height="12" rx="2"/><path d="M17 10l4-2v8l-4-2"/>',
  drive: '<rect x="3" y="12" width="18" height="7" rx="2"/><path d="M5 12l2-7h10l2 7"/><circle cx="17" cy="15.500" r=".6" fill="currentColor"/>',
  code: '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/>',
  archive: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 4v10M10 8h4M10 11h4"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  fwd: '<path d="M9 5l7 7-7 7"/>',
  up: '<path d="M5 15l7-7 7 7"/>',
  list: '<path d="M4 7h2M4 12h2M4 17h2M9 7h11M9 12h11M9 17h11"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.500"/><rect x="13" y="4" width="7" height="7" rx="1.500"/><rect x="4" y="13" width="7" height="7" rx="1.500"/><rect x="13" y="13" width="7" height="7" rx="1.500"/>',
  split: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12"/>',
  newfolder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v5M9.500 12.500h5"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="11" cy="11" r="6.500"/><path d="M16 16l4 4"/>',
  chevron: '<path d="M8 10l4 4 4-4"/>',
  chevronR: '<path d="M10 8l4 4-4 4"/>',
  sort: '<path d="M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};

export const ui = (name: keyof typeof G, cls = "pico") => line(G[name], cls);

const PLACE_BY_NAME: Record<string, keyof typeof G> = {
  home: "home", desktop: "desktop", documents: "doc", downloads: "download",
  pictures: "picture", music: "music", videos: "video",
};

export function placeIcon(name: string, kind: string): string {
  if (kind === "drive") return ui("drive");
  return ui(kind === "home" ? "home" : PLACE_BY_NAME[name.toLowerCase()] ?? "folder");
}

const CODE = new Set(["js", "ts", "rs", "py", "go", "java", "c", "h", "cpp", "json", "html", "css", "sh", "swift", "toml", "yml", "yaml", "xml"]);
const ARCHIVE = new Set(["zip", "tar", "gz", "7z", "rar", "xz", "bz2", "deb", "appimage", "msi", "exe"]);
const IMAGE = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "heic", "avif"]);

/** Small monochrome glyph used in list rows, like the original's SF Symbols. */
export function listIcon(e: Entry): string {
  if (e.kind === "folder") return FOLDER;
  const g = CODE.has(e.ext) ? "code" : ARCHIVE.has(e.ext) ? "archive" : IMAGE.has(e.ext) ? "picture" : "doc";
  return ui(g, "ico glyph");
}
