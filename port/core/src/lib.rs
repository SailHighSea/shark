//! Platform-neutral file system logic for Shark on Windows and Linux.
//! No UI or Tauri types live here so it can be tested anywhere.

pub mod entry;
pub mod ops;
pub mod places;
pub mod undo;

pub use entry::{list_dir, sort_entries, Entry, Kind, SortKey};
pub use ops::{
    check_conflicts, create_folder, disk_free, duplicate, folder_size, rename, transfer, trash_paths,
    Resolution, TransferKind,
};
pub use places::{places, Place};
pub use undo::{undo, UndoEntry, UndoStack};
