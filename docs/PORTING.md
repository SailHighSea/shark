# Porting Shark to Windows and Linux

Status: **plan only.** Nothing here is implemented. Shark today is a macOS 14+ app written in Swift 6 with SwiftUI and AppKit bridges, so the existing source cannot be compiled for Windows or Linux. The dev release workflow already has Windows and Linux jobs; they skip until `port/` exists (see [Release pipeline](#release-pipeline)).

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

## Phases

Each phase ships as a dev pre-release so it can be tried on real machines.

1. **Skeleton.** `port/` Tauri app that opens, lists a folder and navigates. CI builds and tests on both OSes. This switches the Windows and Linux release jobs on.
2. **Browse.** List and icon views, columns, sort, tabs, split panes, path bar, sidebar (places, favorites, drives), type-to-select, Windows-style range selection, session restore.
3. **Operate.** Copy, move, trash, rename, duplicate, undo, collision dialog, drag and drop, clipboard (including cut and paste), folder sizes, live updates from file watching.
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

[`dev-release.yml`](../.github/workflows/dev-release.yml) builds every platform and publishes a GitHub pre-release for each push to `dev`. See [RELEASING.md](RELEASING.md#dev-pre-releases). The Windows and Linux jobs run when `port/src-tauri/tauri.conf.json` exists and expect:

- `port/package.json` and `port/package-lock.json`
- `port/src-tauri/` with the Tauri config and Rust tests (`cargo test`)
- bundle names that the workflow collects: `.deb`, `.AppImage` (Linux) and an NSIS `-setup.exe` (Windows)

If phase 1 uses another layout, update the job paths in the workflow with it.
