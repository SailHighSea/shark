import type { Entry } from "./logic";

const FOLDER = `<svg viewBox="0 0 32 32" class="ico"><path d="M2 8a3 3 0 0 1 3-3h7l3 3h12a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z" fill="var(--folder-back)"/><path d="M2 12a3 3 0 0 1 3-3h22a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z" fill="var(--folder)"/></svg>`;

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

export const PLACE_ICONS: Record<string, string> = {
  home: `<svg viewBox="0 0 16 16" class="pico"><path d="M2 8l6-5 6 5v6H10V10H6v4H2z" fill="currentColor"/></svg>`,
  folder: `<svg viewBox="0 0 16 16" class="pico"><path d="M1.5 4a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5H13A1.5 1.5 0 0 1 14.5 5.500v6.500A1.500 1.500 0 0 1 13 13.500H3A1.500 1.500 0 0 1 1.500 12z" fill="currentColor"/></svg>`,
  drive: `<svg viewBox="0 0 16 16" class="pico"><rect x="1.500" y="5" width="13" height="6.500" rx="1.500" fill="currentColor"/><circle cx="12" cy="8.250" r=".9" fill="var(--bg-side)"/></svg>`,
};
