use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// One reversible change, recorded in the order it happened.
#[derive(Clone, Debug, PartialEq)]
pub enum Step {
    /// A file or folder Shark created (copy, duplicate, new folder). Undo removes it.
    Created(PathBuf),
    /// A move or rename. Undo moves it back.
    Moved { from: PathBuf, to: PathBuf },
    /// Sent to the Trash/Recycle Bin from this path. Undo restores it.
    Trashed(PathBuf),
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct UndoEntry {
    pub label: String,
    #[serde(skip)]
    pub steps: Vec<Step>,
}

#[derive(Default)]
pub struct UndoStack(Vec<UndoEntry>);

impl UndoStack {
    pub fn push(&mut self, entry: UndoEntry) {
        if !entry.steps.is_empty() {
            self.0.push(entry);
            if self.0.len() > 100 {
                self.0.remove(0);
            }
        }
    }
    pub fn pop(&mut self) -> Option<UndoEntry> {
        self.0.pop()
    }
    pub fn len(&self) -> usize {
        self.0.len()
    }
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[cfg(any(windows, all(unix, not(target_os = "macos"))))]
pub fn restore_trashed(path: &Path) -> io::Result<()> {
    let io_err = |e: trash::Error| io::Error::other(e.to_string());
    let mut matches: Vec<_> = trash::os_limited::list()
        .map_err(io_err)?
        .into_iter()
        .filter(|item| item.original_path() == path)
        .collect();
    matches.sort_by_key(|item| item.time_deleted);
    match matches.pop() {
        Some(item) => trash::os_limited::restore_all([item]).map_err(io_err),
        None => Err(io::Error::new(io::ErrorKind::NotFound, "Not in the Trash any more")),
    }
}

#[cfg(not(any(windows, all(unix, not(target_os = "macos")))))]
pub fn restore_trashed(_path: &Path) -> io::Result<()> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "Restoring from the Trash is not supported here"))
}

/// Reverses an entry. Stops at the first failure and says which path blocked it.
pub fn undo(entry: &UndoEntry) -> io::Result<()> {
    for step in entry.steps.iter().rev() {
        match step {
            Step::Created(path) => match fs::symlink_metadata(path) {
                Ok(m) if m.is_dir() => fs::remove_dir_all(path)?,
                Ok(_) => fs::remove_file(path)?,
                Err(_) => {}
            },
            Step::Moved { from, to } => {
                if fs::symlink_metadata(from).is_ok() {
                    return Err(io::Error::new(
                        io::ErrorKind::AlreadyExists,
                        format!("{} already exists", from.display()),
                    ));
                }
                crate::ops::move_path(to, from)?;
            }
            Step::Trashed(path) => restore_trashed(path)?,
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stack_ignores_empty_entries_and_caps() {
        let mut s = UndoStack::default();
        s.push(UndoEntry { label: "x".into(), steps: vec![] });
        assert!(s.is_empty());
        for i in 0..105 {
            s.push(UndoEntry { label: i.to_string(), steps: vec![Step::Created("a".into())] });
        }
        assert_eq!(s.len(), 100);
        assert_eq!(s.pop().unwrap().label, "104");
    }
}
