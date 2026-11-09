# Porting Shark to Windows and Linux

Status: **phases 1 to 3 are implemented in `port/`** (skeleton, browse, operate). Phases 4 to 7 are still plans. Shark itself is a macOS 14+ app written in Swift 6 with SwiftUI and AppKit bridges, so its source cannot be compiled for Windows or Linux; the port in `port/` re-implements it. See [`port/README.md`](../port/README.md) to build and run it.

## Why a rewrite of the UI is unavoidable

- 62 of 150 Swift files import AppKit or SwiftUI. Views, drag and drop, Quick Look, the Photo Viewer and the toolbar have no Windows or Linux counterpart.
- SwiftUI is Apple-only, and Swift has no mature native GUI toolkit on Windows or Linux.
- Services lean on macOS APIs: FSEvents, `NSWorkspace`, security-scoped bookmarks, Quick Look, Spotlight, Finder tags, iCloud, Firebase.

## Recommended approach

**Tauri 2: a Rust core with a TypeScript web UI**, in a new `port/` directory next to the Swift app.

| Option | Verdict |
| --- | --- |
| **Tauri 2 (Rust + web UI)** | Chosen. One codebase for both OSes, small installers, native webview, Rust for file system, watching and PTY work, and installers for deb, AppImage and NSIS. |
| Share Swift core, new UI per OS | Swift on Windows and Linux works for logic, but each platform still needs a separate UI toolkit. More total work. |
| Qt (C++ or Rust) | Strong native look, heavier tooling and licensing. Reasonable fallback if webview performance is a problem. |
| Electron | Faster to start, but large downloads and memory. Conflicts with Shark's speed focus. |

The Swift app stays the reference for behaviour. The port re-implements it; it does not share code.

## Layout of `port/`

- `core/`: the `shark-core` Rust crate. Listing, sorting, places, copy / move / trash / rename / duplicate, collision handling, undo and folder sizes. No UI types, fully unit tested.
- `src-tauri/`: the Tauri shell. Thin commands over `shark-core`, file watching (`notify`) and opening files with the system handler.
- `src/`: the TypeScript UI (no framework). `logic.ts` holds the pure, tested helpers; `mock.ts` is an in-memory file system used when the page runs outside Tauri, for browser testing.

## Design parity with the macOS app

The UI follows [`DESIGN.md`](../DESIGN.md) and the screenshots in `docs/screenshots`. Dark-mode colors in `port/src/style.css` are sampled from those screenshots; light-mode colors are standard macOS equivalents, since no light screenshot exists.

Matched: one toolbar with Navigation and Location capsules and 9 pt captions, a full-width tab strip (34 pt, equal-width capsule tabs with centered titles, circular add button, double-click empty strip for a new tab, wheel to switch), an inset 20 pt sidebar with collapsible Favorites and Locations sections (32 pt rows), striped list rows (26 pt) with Name, Size, Date Modified and Kind columns, blue full-row selection, split-pane headers ("Left Pane" and "Right Pane" with a close button), a 22 pt status bar ("10 items • 1 selected (Zero KB) • 98.71 GB available"), icon zoom (48 to 192 pt with Ctrl+plus, Ctrl+minus, Ctrl+0, Ctrl+wheel and a slider), Finder-style size and kind wording, and double-click on empty space to go up.

Not matched, on purpose or for now:
- **No Liquid Glass, vibrancy or wallpaper bleed-through.** A webview can't blur the desktop behind the window, so surfaces are flat colors.
- **The window uses the native title bar** of each OS rather than a unified toolbar with traffic lights, so Windows and Linux keep their own window controls.
- **Not ported yet:** Favorites you add yourself, Recents, Tags, Miller Columns and Gallery views, Share, Terminal, Action menu, pinned and tinted tabs, tab groups, the inspector, the command palette and hover previews. Their buttons are left out rather than shown disabled.
- **Icons** are simple outline glyphs in lists and badge-style file icons in the icon view, not macOS system icons or image thumbnails (phase 4).

## Known gaps in phases 1 to 3

- **Clipboard is in-app only.** Cut, copy and paste work between Shark tabs and panes, not with Explorer or other file managers. Dragging files in from or out to other apps is not supported.
- **User-added Favorites** are not implemented; Favorites lists the standard folders that exist, and Locations lists home and drives.
- **No rubber-band selection** and no virtualised list; very large folders render every row.
- **Move vs copy on drag** is Move by default and Ctrl for Copy, on every drive.
- **Windows and Linux have not been run on real machines by the author of this change.** The Linux build compiles and the UI is tested against the mock file system in a browser; the Windows build is covered only by CI.

## Phases

Each phase ships as a dev pre-release so it can be tried on real machines.

1. **Skeleton. Done.** Tauri 2 app in `port/` that opens, lists a folder and navigates. CI builds and tests on Linux and Windows, and the dev release publishes `.deb`, `.AppImage` and NSIS installers.
2. **Browse. Done** (except favorites). List and icon views, sortable columns, tabs, split panes, editable path bar with breadcrumbs, sidebar with places and drives, filter, hidden-file toggle, type-to-select, Windows-style range selection, session restore.
3. **Operate. Done.** Copy, move, trash, rename (inline), new folder, duplicate, undo, a Replace / Keep Both / Skip / Stop collision dialog with Apply to all, drag and drop (Ctrl copies), cut / copy / paste, folder sizes, live refresh from file watching.
4. **Preview and inspect.** Thumbnails, preview pane, hover preview, inspector, photo viewer, Open With.
5. **Power features.** Integrated terminal drawer (ConPTY on Windows, PTY on Linux), command palette, filter and search, settings, mouse bindings, localization (8 languages from the existing `.lproj` strings).
6. **Platform polish.** Native context menus and shortcut conventions (Ctrl instead of Command), High DPI, dark mode, Windows Explorer and Linux file-manager integration (default folder handler), auto update check.
7. **Distribution.** Windows code signing, Linux repository or Flatpak, WinGet and Scoop manifests.

## macOS feature mapping

| macOS feature | Windows | Linux |
| --- | --- | --- |
| FSEvents | `notify` crate (ReadDirectoryChangesW) | `notify` crate (inotify) |
| Trash and Put Back | Recycle Bin via `trash` crate | freedesktop.org Trash spec via `trash` crate |
| `NSWorkspace` Open With, default apps | `ShellExecute`, registry handlers | `xdg-open`, `.desktop` files, `gio` |
| Terminal drawer (SwiftTerm, PTY) | ConPTY with xterm.js | `portable-pty` with xterm.js |
| Quick Look | In-app preview pane (no system equivalent) | Same |
| Thumbnails | Windows thumbnail cache API, `image` crate fallback | freedesktop thumbnail spec, `image` crate fallback |
| Finder tags, iCloud, AirDrop | Not ported | Not ported |
| Eject volumes | `CM_Request_Device_Eject` | `udisks2` over D-Bus |
| Security-scoped bookmarks, sandbox | Not needed | Flatpak portals if sandboxed |
| Spotlight search | Name walk first; Windows Search index later | Name walk first; `locate` or tracker later |
| Firebase analytics and crash reports | Off by default; decide separately | Off by default; decide separately |
| Command-key shortcuts | Ctrl, with the same bindings where possible | Ctrl |

macOS-only items stay out of the Windows and Linux builds and are not claimed on the features page for them.

## Docs to update when the port ships

- `website/src/data/features.ts`: add platform availability per feature, and only list what is implemented on each OS.
- `MouseHelp.zones` and the in-app Help: keep the Swift app as is; the port needs its own Help page with the same zone grouping.
- `README.md`, `PRODUCT.md`: platforms and install instructions.

## Release pipeline

[`dev-release.yml`](../.github/workflows/dev-release.yml) builds every platform and publishes a GitHub pre-release for each push to `dev`. See [RELEASING.md](RELEASING.md#dev-pre-releases). The Windows and Linux jobs run the tests (`npm run typecheck`, `npm test`, `cargo test` on `core/`), build with `tauri build`, and publish a `.deb` and `.AppImage` (Linux) and an NSIS `-setup.exe` (Windows). [`port-ci.yml`](../.github/workflows/port-ci.yml) runs the same tests on every push or pull request that touches `port/`. The jobs skip themselves if `port/src-tauri/tauri.conf.json` is ever removed.
