use crate::undo::{Step, UndoEntry};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TransferKind {
    Copy,
    Move,
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Resolution {
    /// The existing item goes to the Trash, so this can be undone.
    Replace,
    KeepBoth,
    Skip,
}

#[derive(Serialize, Default, Debug)]
pub struct Outcome {
    /// Paths that now exist as a result (new copies, new locations, new names).
    pub paths: Vec<String>,
    pub skipped: usize,
    pub errors: Vec<String>,
    #[serde(skip)]
    pub undo: Option<UndoEntry>,
}

fn exists(p: &Path) -> bool {
    fs::symlink_metadata(p).is_ok()
}

fn split_name(name: &str, is_dir: bool) -> (&str, &str) {
    match name.rfind('.') {
        Some(i) if !is_dir && i > 0 && i + 1 < name.len() => (&name[..i], &name[i..]),
        _ => (name, ""),
    }
}

/// "report.txt" -> "report 2.txt" -> "report 3.txt" ... first name not taken in `dir`.
pub fn unique_name(dir: &Path, name: &str, is_dir: bool) -> PathBuf {
    let first = dir.join(name);
    if !exists(&first) {
        return first;
    }
    let (stem, ext) = split_name(name, is_dir);
    (2..)
        .map(|n| dir.join(format!("{stem} {n}{ext}")))
        .find(|p| !exists(p))
        .expect("unbounded range")
}

fn is_dir(p: &Path) -> bool {
    fs::symlink_metadata(p).map(|m| m.is_dir()).unwrap_or(false)
}

fn file_name(p: &Path) -> io::Result<String> {
    p.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "No name"))
}

pub fn copy_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    let meta = fs::symlink_metadata(src)?;
    if meta.is_dir() {
        fs::create_dir(dst)?;
        for item in fs::read_dir(src)? {
            let item = item?;
            copy_recursive(&item.path(), &dst.join(item.file_name()))?;
        }
        Ok(())
    } else if meta.file_type().is_symlink() {
        copy_symlink(src, dst)
    } else {
        fs::copy(src, dst).map(|_| ())
    }
}

#[cfg(unix)]
fn copy_symlink(src: &Path, dst: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(fs::read_link(src)?, dst)
}

#[cfg(windows)]
fn copy_symlink(src: &Path, dst: &Path) -> io::Result<()> {
    // Creating links needs privileges on Windows; copy what the link points to instead.
    if fs::metadata(src)?.is_dir() { copy_recursive(src, dst) } else { fs::copy(src, dst).map(|_| ()) }
}

fn is_cross_device(e: &io::Error) -> bool {
    e.kind() == io::ErrorKind::CrossesDevices || matches!(e.raw_os_error(), Some(18) | Some(17))
}

/// Rename when possible; copy then delete across drives.
pub fn move_path(src: &Path, dst: &Path) -> io::Result<()> {
    match fs::rename(src, dst) {
        Err(e) if is_cross_device(&e) => {
            copy_recursive(src, dst)?;
            if is_dir(src) { fs::remove_dir_all(src) } else { fs::remove_file(src) }
        }
        other => other,
    }
}

pub fn trash_one(path: &Path) -> io::Result<()> {
    trash::delete(path).map_err(|e| io::Error::other(e.to_string()))
}

/// Sources whose target name already exists in `dest` (excluding same-folder cases,
/// which are resolved automatically).
pub fn check_conflicts(sources: &[PathBuf], dest: &Path) -> Vec<String> {
    sources
        .iter()
        .filter(|s| s.parent() != Some(dest))
        .filter(|s| file_name(s).map(|n| exists(&dest.join(n))).unwrap_or(false))
        .map(|s| s.to_string_lossy().into_owned())
        .collect()
}

/// Copies or moves `sources` into `dest`. `resolutions` is keyed by source path; a conflict
/// with no resolution is skipped so nothing is overwritten by accident.
pub fn transfer(
    sources: &[PathBuf],
    dest: &Path,
    kind: TransferKind,
    resolutions: &HashMap<String, Resolution>,
) -> Outcome {
    let mut out = Outcome::default();
    let mut steps = Vec::new();
    for src in sources {
        let key = src.to_string_lossy().into_owned();
        let result = (|| -> io::Result<Option<PathBuf>> {
            let name = file_name(src)?;
            let dir = is_dir(src);
            if dir && (dest == src || dest.starts_with(src)) {
                return Err(io::Error::new(io::ErrorKind::InvalidInput, format!("Can't put \"{name}\" inside itself")));
            }
            let same_folder = src.parent() == Some(dest);
            if same_folder && kind == TransferKind::Move {
                return Ok(None);
            }
            let mut target = dest.join(&name);
            if same_folder {
                target = unique_name(dest, &name, dir);
            } else if exists(&target) {
                match resolutions.get(&key).copied().unwrap_or(Resolution::Skip) {
                    Resolution::Skip => return Ok(None),
                    Resolution::KeepBoth => target = unique_name(dest, &name, dir),
                    Resolution::Replace => {
                        trash_one(&target)?;
                        steps.push(Step::Trashed(target.clone()));
                    }
                }
            }
            match kind {
                TransferKind::Copy => {
                    copy_recursive(src, &target)?;
                    steps.push(Step::Created(target.clone()));
                }
                TransferKind::Move => {
                    move_path(src, &target)?;
                    steps.push(Step::Moved { from: src.clone(), to: target.clone() });
                }
            }
            Ok(Some(target))
        })();
        match result {
            Ok(Some(t)) => out.paths.push(t.to_string_lossy().into_owned()),
            Ok(None) => out.skipped += 1,
            Err(e) => out.errors.push(format!("{}: {e}", src.display())),
        }
    }
    let verb = if kind == TransferKind::Copy { "Copy" } else { "Move" };
    out.undo = Some(UndoEntry { label: format!("{verb} {} item(s)", out.paths.len()), steps });
    out
}

/// Sends paths to the Trash/Recycle Bin (one at a time so a failure doesn't hide the others).
pub fn trash_paths(paths: &[PathBuf]) -> Outcome {
    let mut out = Outcome::default();
    let mut steps = Vec::new();
    for p in paths {
        match trash_one(p) {
            Ok(()) => steps.push(Step::Trashed(p.clone())),
            Err(e) => out.errors.push(format!("{}: {e}", p.display())),
        }
    }
    out.undo = Some(UndoEntry { label: format!("Move {} item(s) to Trash", steps.len()), steps });
    out
}

fn valid_name(name: &str) -> io::Result<()> {
    let bad = name.is_empty()
        || name == "."
        || name == ".."
        || name.contains(['/', '\\', '\0'])
        || (cfg!(windows) && name.contains([':', '*', '?', '"', '<', '>', '|']));
    if bad {
        Err(io::Error::new(io::ErrorKind::InvalidInput, "That name can't be used"))
    } else {
        Ok(())
    }
}

pub fn rename(path: &Path, new_name: &str) -> io::Result<Outcome> {
    valid_name(new_name)?;
    let target = path.with_file_name(new_name);
    if target == path {
        return Ok(Outcome::default());
    }
    // A case-only change is the same file on case-insensitive volumes.
    let case_only = target.to_string_lossy().to_lowercase() == path.to_string_lossy().to_lowercase();
    if exists(&target) && !case_only {
        return Err(io::Error::new(io::ErrorKind::AlreadyExists, format!("\"{new_name}\" already exists")));
    }
    fs::rename(path, &target)?;
    Ok(Outcome {
        paths: vec![target.to_string_lossy().into_owned()],
        undo: Some(UndoEntry {
            label: "Rename".into(),
            steps: vec![Step::Moved { from: path.to_path_buf(), to: target }],
        }),
        ..Outcome::default()
    })
}

pub fn create_folder(dir: &Path, name: &str) -> io::Result<Outcome> {
    valid_name(name)?;
    let target = unique_name(dir, name, true);
    fs::create_dir(&target)?;
    Ok(Outcome {
        paths: vec![target.to_string_lossy().into_owned()],
        undo: Some(UndoEntry { label: "New Folder".into(), steps: vec![Step::Created(target)] }),
        ..Outcome::default()
    })
}

/// Copies each item next to itself as "name copy", "name copy 2", ...
pub fn duplicate(paths: &[PathBuf]) -> Outcome {
    let mut out = Outcome::default();
    let mut steps = Vec::new();
    for p in paths {
        let result = (|| {
            let name = file_name(p)?;
            let dir = is_dir(p);
            let (stem, ext) = split_name(&name, dir);
            let target = unique_name(p.parent().unwrap_or(Path::new(".")), &format!("{stem} copy{ext}"), dir);
            copy_recursive(p, &target)?;
            Ok::<_, io::Error>(target)
        })();
        match result {
            Ok(t) => {
                steps.push(Step::Created(t.clone()));
                out.paths.push(t.to_string_lossy().into_owned());
            }
            Err(e) => out.errors.push(format!("{}: {e}", p.display())),
        }
    }
    out.undo = Some(UndoEntry { label: "Duplicate".into(), steps });
    out
}

/// Free bytes on the volume holding `path`, or None when it can't be read.
pub fn disk_free(path: &Path) -> Option<u64> {
    fs4::available_space(path).ok()
}

/// Total bytes and item count under `path`. Links are counted but not followed.
pub fn folder_size(path: &Path) -> (u64, u64) {
    let (mut bytes, mut items) = (0, 0);
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for item in rd.flatten() {
            let Ok(m) = item.metadata() else { continue };
            items += 1;
            if m.is_dir() {
                stack.push(item.path());
            } else {
                bytes += m.len();
            }
        }
    }
    (bytes, items)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::undo::undo;
    use tempfile::{tempdir, TempDir};

    fn file(dir: &TempDir, rel: &str, body: &str) -> PathBuf {
        let p = dir.path().join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, body).unwrap();
        p
    }

    #[test]
    fn unique_names() {
        let d = tempdir().unwrap();
        file(&d, "a.txt", "");
        file(&d, "a 2.txt", "");
        file(&d, ".rc", "");
        fs::create_dir(d.path().join("my.dir")).unwrap();
        assert_eq!(unique_name(d.path(), "a.txt", false), d.path().join("a 3.txt"));
        assert_eq!(unique_name(d.path(), ".rc", false), d.path().join(".rc 2"));
        assert_eq!(unique_name(d.path(), "my.dir", true), d.path().join("my.dir 2"));
        assert_eq!(unique_name(d.path(), "fresh", false), d.path().join("fresh"));
    }

    #[test]
    fn copy_folder_tree_and_undo() {
        let d = tempdir().unwrap();
        file(&d, "src/a/b.txt", "deep");
        let dest = d.path().join("out");
        fs::create_dir(&dest).unwrap();
        let o = transfer(&[d.path().join("src")], &dest, TransferKind::Copy, &HashMap::new());
        assert!(o.errors.is_empty(), "{:?}", o.errors);
        assert_eq!(fs::read_to_string(dest.join("src/a/b.txt")).unwrap(), "deep");
        undo(&o.undo.unwrap()).unwrap();
        assert!(!dest.join("src").exists());
        assert!(d.path().join("src/a/b.txt").exists());
    }

    #[test]
    fn move_and_undo() {
        let d = tempdir().unwrap();
        let f = file(&d, "x.txt", "1");
        let dest = d.path().join("to");
        fs::create_dir(&dest).unwrap();
        let o = transfer(&[f.clone()], &dest, TransferKind::Move, &HashMap::new());
        assert!(!f.exists() && dest.join("x.txt").exists());
        undo(&o.undo.unwrap()).unwrap();
        assert!(f.exists() && !dest.join("x.txt").exists());
    }

    #[test]
    fn conflicts_skip_by_default_and_keep_both() {
        let d = tempdir().unwrap();
        let a = file(&d, "in/a.txt", "new");
        file(&d, "out/a.txt", "old");
        let dest = d.path().join("out");
        assert_eq!(check_conflicts(&[a.clone()], &dest), vec![a.to_string_lossy().into_owned()]);
        let o = transfer(&[a.clone()], &dest, TransferKind::Copy, &HashMap::new());
        assert_eq!((o.skipped, o.paths.len()), (1, 0));
        assert_eq!(fs::read_to_string(dest.join("a.txt")).unwrap(), "old");
        let res = HashMap::from([(a.to_string_lossy().into_owned(), Resolution::KeepBoth)]);
        let o = transfer(&[a], &dest, TransferKind::Copy, &res);
        assert_eq!(fs::read_to_string(dest.join("a 2.txt")).unwrap(), "new");
        assert_eq!(o.paths.len(), 1);
    }

    #[test]
    fn same_folder_copy_makes_a_numbered_copy_and_move_is_a_noop() {
        let d = tempdir().unwrap();
        let a = file(&d, "a.txt", "1");
        assert!(check_conflicts(&[a.clone()], d.path()).is_empty());
        let o = transfer(&[a.clone()], d.path(), TransferKind::Copy, &HashMap::new());
        assert!(d.path().join("a 2.txt").exists() && o.errors.is_empty());
        let o = transfer(&[a], d.path(), TransferKind::Move, &HashMap::new());
        assert_eq!(o.skipped, 1);
    }

    #[test]
    fn folder_cannot_go_into_itself() {
        let d = tempdir().unwrap();
        file(&d, "f/x", "");
        let o = transfer(&[d.path().join("f")], &d.path().join("f"), TransferKind::Copy, &HashMap::new());
        assert_eq!(o.errors.len(), 1);
    }

    #[test]
    fn rename_rules() {
        let d = tempdir().unwrap();
        let a = file(&d, "a.txt", "");
        file(&d, "b.txt", "");
        assert!(rename(&a, "b.txt").is_err());
        assert!(rename(&a, "x/y").is_err());
        assert!(rename(&a, "..").is_err());
        let o = rename(&a, "c.txt").unwrap();
        assert!(d.path().join("c.txt").exists());
        undo(&o.undo.unwrap()).unwrap();
        assert!(a.exists());
    }

    #[test]
    fn undo_refuses_to_clobber() {
        let d = tempdir().unwrap();
        let a = file(&d, "a.txt", "");
        let o = rename(&a, "c.txt").unwrap();
        file(&d, "a.txt", "someone made this");
        assert!(undo(&o.undo.unwrap()).is_err());
    }

    #[test]
    fn new_folder_and_duplicate() {
        let d = tempdir().unwrap();
        let o = create_folder(d.path(), "untitled folder").unwrap();
        let o2 = create_folder(d.path(), "untitled folder").unwrap();
        assert!(o.paths[0].ends_with("untitled folder") && o2.paths[0].ends_with("untitled folder 2"));
        let a = file(&d, "a.txt", "z");
        let o = duplicate(&[a.clone(), a]);
        assert_eq!(fs::read_to_string(d.path().join("a copy.txt")).unwrap(), "z");
        assert!(d.path().join("a copy 2.txt").exists());
        assert_eq!(o.paths.len(), 2);
    }

    #[test]
    fn free_space_is_reported() {
        let d = tempdir().unwrap();
        assert!(disk_free(d.path()).is_some());
        assert!(disk_free(&d.path().join("nope")).is_none());
    }

    #[test]
    fn sizes() {
        let d = tempdir().unwrap();
        file(&d, "a/x", "123");
        file(&d, "a/b/y", "45");
        assert_eq!(folder_size(d.path()), (5, 4));
    }

    #[test]
    fn trash_replace_and_restore() {
        let d = tempdir().unwrap();
        let a = file(&d, "in/a.txt", "new");
        file(&d, "out/a.txt", "old");
        let dest = d.path().join("out");
        let res = HashMap::from([(a.to_string_lossy().into_owned(), Resolution::Replace)]);
        let o = transfer(&[a], &dest, TransferKind::Copy, &res);
        if !o.errors.is_empty() {
            eprintln!("trash unavailable here, skipping: {:?}", o.errors);
            return;
        }
        assert_eq!(fs::read_to_string(dest.join("a.txt")).unwrap(), "new");
        undo(&o.undo.unwrap()).unwrap();
        assert_eq!(fs::read_to_string(dest.join("a.txt")).unwrap(), "old");
    }
}
