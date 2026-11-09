# Shark for Windows and Linux

Tauri 2 port of Shark. A Rust core (`core/`) does the file work, a thin Tauri shell (`src-tauri/`) exposes it, and a TypeScript UI (`src/`) renders it. See [`docs/PORTING.md`](../docs/PORTING.md) for the plan and known gaps.

## Requirements

- Node 22 and Rust (stable)
- Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf`
- Windows: WebView2 (already part of Windows 11) and the MSVC build tools

## Run and test

```sh
npm ci
npm run tauri dev          # desktop app with hot reload
npm run dev                # UI alone in a browser, on an in-memory file system (src/mock.ts)
npm run typecheck && npm test
cargo test --manifest-path core/Cargo.toml
npm run tauri build -- --bundles deb,appimage   # Linux; use --bundles nsis on Windows
```

Keep file system behaviour in `core/` with a test. If the UI calls a new command, add it to `src/api.ts`, `src/mock.ts` and `src-tauri/src/lib.rs`.

## Keys

Arrows, Home, End and Shift extend selection; type to jump; Enter opens; F2 renames; Delete trashes; Ctrl+C / X / V / D copy, cut, paste, duplicate; Ctrl+Z undo; Ctrl+Shift+N new folder; Ctrl+T / W / Tab tabs; Ctrl+\ split; Ctrl+L path; Ctrl+F filter; Ctrl+H hidden files; Alt+←/→/↑ history and parent; F5 refresh.
