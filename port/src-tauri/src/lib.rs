//! Tauri shell: thin commands over `shark-core`. Logic belongs in the core crate.

use notify_debouncer_mini::{
    new_debouncer,
    notify::{RecommendedWatcher, RecursiveMode},
    Debouncer,
};
use serde::Serialize;
use shark_core::{
    ops, Entry, Place, Resolution, SortKey, TransferKind, UndoEntry, UndoStack,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn paths(v: Vec<String>) -> Vec<PathBuf> {
    v.into_iter().map(PathBuf::from).collect()
}

#[derive(Default)]
struct AppState {
    undo: Mutex<UndoStack>,
    watcher: Mutex<Option<Debouncer<RecommendedWatcher>>>,
}

/// What the UI gets back from a file operation.
#[derive(Serialize)]
struct OpResult {
    paths: Vec<String>,
    skipped: usize,
    errors: Vec<String>,
    can_undo: bool,
}

fn finish(state: &AppState, out: ops::Outcome) -> OpResult {
    let mut undo = state.undo.lock().unwrap();
    if let Some(entry) = out.undo {
        undo.push(entry);
    }
    OpResult { paths: out.paths, skipped: out.skipped, errors: out.errors, can_undo: !undo.is_empty() }
}

#[tauri::command]
fn home_dir() -> String {
    shark_core::places().first().map(|p| p.path.clone()).unwrap_or_else(|| "/".into())
}

#[tauri::command]
fn list_places() -> Vec<Place> {
    shark_core::places()
}

#[tauri::command]
fn list_dir(path: String, show_hidden: bool, sort: SortKey, ascending: bool) -> CmdResult<Vec<Entry>> {
    let mut entries = shark_core::list_dir(Path::new(&path), show_hidden).map_err(err)?;
    shark_core::sort_entries(&mut entries, sort, ascending);
    Ok(entries)
}

#[tauri::command]
fn parent_dir(path: String) -> Option<String> {
    Path::new(&path).parent().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn check_conflicts(sources: Vec<String>, dest: String) -> Vec<String> {
    shark_core::check_conflicts(&paths(sources), Path::new(&dest))
}

#[tauri::command]
fn transfer(
    state: State<AppState>,
    sources: Vec<String>,
    dest: String,
    kind: TransferKind,
    resolutions: HashMap<String, Resolution>,
) -> OpResult {
    finish(&state, shark_core::transfer(&paths(sources), Path::new(&dest), kind, &resolutions))
}

#[tauri::command]
fn trash(state: State<AppState>, targets: Vec<String>) -> OpResult {
    finish(&state, shark_core::trash_paths(&paths(targets)))
}

#[tauri::command]
fn rename(state: State<AppState>, path: String, new_name: String) -> CmdResult<OpResult> {
    Ok(finish(&state, shark_core::rename(Path::new(&path), &new_name).map_err(err)?))
}

#[tauri::command]
fn new_folder(state: State<AppState>, dir: String) -> CmdResult<OpResult> {
    Ok(finish(&state, shark_core::create_folder(Path::new(&dir), "untitled folder").map_err(err)?))
}

#[tauri::command]
fn duplicate(state: State<AppState>, targets: Vec<String>) -> OpResult {
    finish(&state, shark_core::duplicate(&paths(targets)))
}

#[derive(Serialize)]
struct UndoResult {
    label: String,
    can_undo: bool,
}

#[tauri::command]
fn undo(state: State<AppState>) -> CmdResult<UndoResult> {
    let mut stack = state.undo.lock().unwrap();
    let entry: UndoEntry = stack.pop().ok_or("Nothing to undo")?;
    shark_core::undo(&entry).map_err(err)?;
    Ok(UndoResult { label: entry.label, can_undo: !stack.is_empty() })
}

#[derive(Serialize)]
struct FolderSize {
    bytes: u64,
    items: u64,
}

#[tauri::command]
async fn folder_size(path: String) -> FolderSize {
    // Off the UI thread: a big folder can take seconds.
    tauri::async_runtime::spawn_blocking(move || {
        let (bytes, items) = shark_core::folder_size(Path::new(&path));
        FolderSize { bytes, items }
    })
    .await
    .unwrap_or(FolderSize { bytes: 0, items: 0 })
}

#[tauri::command]
fn open_path(path: String) -> CmdResult<()> {
    use std::process::Command;
    #[cfg(windows)]
    let mut cmd = Command::new("explorer.exe");
    #[cfg(not(windows))]
    let mut cmd = Command::new("xdg-open");
    cmd.arg(&path).spawn().map(|_| ()).map_err(err)
}

/// Watches exactly these folders (replacing the previous set) and emits `dir-changed`.
#[tauri::command]
fn watch_dirs(app: AppHandle, state: State<AppState>, dirs: Vec<String>) -> CmdResult<()> {
    let handle = app.clone();
    let mut debouncer = new_debouncer(Duration::from_millis(150), move |res: notify_debouncer_mini::DebounceEventResult| {
        if let Ok(events) = res {
            let mut seen: Vec<String> = Vec::new();
            for e in events {
                if let Some(parent) = e.path.parent() {
                    let p = parent.to_string_lossy().into_owned();
                    if !seen.contains(&p) {
                        seen.push(p);
                    }
                }
                // The folder itself changed (e.g. it was deleted or renamed).
                let own = e.path.to_string_lossy().into_owned();
                if !seen.contains(&own) {
                    seen.push(own);
                }
            }
            let _ = handle.emit("dir-changed", seen);
        }
    })
    .map_err(err)?;
    for d in dirs {
        // A folder that vanished is reported by the next listing, so ignore watch errors.
        let _ = debouncer.watcher().watch(Path::new(&d), RecursiveMode::NonRecursive);
    }
    *state.watcher.lock().unwrap() = Some(debouncer);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            home_dir,
            list_places,
            list_dir,
            parent_dir,
            check_conflicts,
            transfer,
            trash,
            rename,
            new_folder,
            duplicate,
            undo,
            folder_size,
            open_path,
            watch_dirs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Shark");
}
