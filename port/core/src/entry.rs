use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::fs;
use std::io;
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    File,
    Folder,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub kind: Kind,
    pub is_symlink: bool,
    pub size: u64,
    /// Milliseconds since the Unix epoch.
    pub modified: Option<i64>,
    pub hidden: bool,
    /// Lowercase extension without the dot; empty for folders and dotfiles.
    pub ext: String,
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SortKey {
    Name,
    Size,
    Modified,
    Kind,
}

#[cfg(windows)]
fn is_hidden(name: &str, meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    name.starts_with('.') || meta.file_attributes() & 0x2 != 0
}

#[cfg(not(windows))]
fn is_hidden(name: &str, _meta: &fs::Metadata) -> bool {
    name.starts_with('.')
}

/// Lowercase extension; a leading dot (".bashrc") is not an extension.
pub fn extension_of(name: &str) -> String {
    match name.rfind('.') {
        Some(i) if i > 0 && i + 1 < name.len() => name[i + 1..].to_lowercase(),
        _ => String::new(),
    }
}

/// Lists a folder. Unreadable entries are skipped; the folder itself must be readable.
pub fn list_dir(path: &Path, show_hidden: bool) -> io::Result<Vec<Entry>> {
    let mut out = Vec::new();
    for item in fs::read_dir(path)? {
        let Ok(item) = item else { continue };
        let name = item.file_name().to_string_lossy().into_owned();
        let Ok(link_meta) = fs::symlink_metadata(item.path()) else { continue };
        let is_symlink = link_meta.file_type().is_symlink();
        // Follow links so a link to a folder opens like a folder; a broken link stays a file.
        let meta = if is_symlink { fs::metadata(item.path()).unwrap_or(link_meta) } else { link_meta };
        let hidden = is_hidden(&name, &meta);
        if hidden && !show_hidden {
            continue;
        }
        let kind = if meta.is_dir() { Kind::Folder } else { Kind::File };
        out.push(Entry {
            ext: if kind == Kind::Folder { String::new() } else { extension_of(&name) },
            path: item.path().to_string_lossy().into_owned(),
            size: if kind == Kind::Folder { 0 } else { meta.len() },
            modified: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64),
            name,
            kind,
            is_symlink,
            hidden,
        });
    }
    Ok(out)
}

/// Case-insensitive comparison where digit runs compare as numbers ("file2" < "file10").
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (mut a, mut b) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (a.peek().copied(), b.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, _) => return Ordering::Less,
            (_, None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let take = |it: &mut std::iter::Peekable<std::str::Chars>| {
                    let mut s = String::new();
                    while let Some(c) = it.peek().copied().filter(char::is_ascii_digit) {
                        s.push(c);
                        it.next();
                    }
                    s.trim_start_matches('0').to_string()
                };
                let (x, y) = (take(&mut a), take(&mut b));
                let ord = x.len().cmp(&y.len()).then_with(|| x.cmp(&y));
                if ord != Ordering::Equal {
                    return ord;
                }
            }
            (Some(x), Some(y)) => {
                let ord = x.to_lowercase().cmp(y.to_lowercase());
                if ord != Ordering::Equal {
                    return ord;
                }
                a.next();
                b.next();
            }
        }
    }
}

/// Folders always come first, as in Finder and Explorer.
pub fn sort_entries(entries: &mut [Entry], key: SortKey, ascending: bool) {
    entries.sort_by(|a, b| {
        let folders = (a.kind == Kind::File).cmp(&(b.kind == Kind::File));
        if folders != Ordering::Equal {
            return folders;
        }
        let by_name = natural_cmp(&a.name, &b.name);
        let ord = match key {
            SortKey::Name => by_name,
            SortKey::Size => a.size.cmp(&b.size).then(by_name),
            SortKey::Modified => a.modified.cmp(&b.modified).then(by_name),
            SortKey::Kind => a.ext.cmp(&b.ext).then(by_name),
        };
        if ascending { ord } else { ord.reverse() }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(name: &str, kind: Kind, size: u64) -> Entry {
        Entry {
            name: name.into(),
            path: name.into(),
            kind,
            is_symlink: false,
            size,
            modified: None,
            hidden: false,
            ext: extension_of(name),
        }
    }

    #[test]
    fn extensions() {
        assert_eq!(extension_of("a.TXT"), "txt");
        assert_eq!(extension_of(".bashrc"), "");
        assert_eq!(extension_of("archive.tar.gz"), "gz");
        assert_eq!(extension_of("trailing."), "");
    }

    #[test]
    fn natural_order() {
        assert_eq!(natural_cmp("file2", "file10"), Ordering::Less);
        assert_eq!(natural_cmp("File", "file"), Ordering::Equal);
        assert_eq!(natural_cmp("a01", "a1"), Ordering::Equal);
        assert_eq!(natural_cmp("a", "ab"), Ordering::Less);
    }

    #[test]
    fn folders_first_and_reverse() {
        let mut v = vec![e("b.txt", Kind::File, 1), e("Zed", Kind::Folder, 0), e("a.txt", Kind::File, 9)];
        sort_entries(&mut v, SortKey::Name, true);
        assert_eq!(v.iter().map(|x| x.name.as_str()).collect::<Vec<_>>(), ["Zed", "a.txt", "b.txt"]);
        sort_entries(&mut v, SortKey::Size, false);
        assert_eq!(v.iter().map(|x| x.name.as_str()).collect::<Vec<_>>(), ["Zed", "a.txt", "b.txt"]);
    }

    #[test]
    fn lists_and_hides_dotfiles() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("a.txt"), "hi").unwrap();
        fs::write(d.path().join(".secret"), "").unwrap();
        fs::create_dir(d.path().join("sub")).unwrap();
        let shown = list_dir(d.path(), false).unwrap();
        assert_eq!(shown.len(), 2);
        assert_eq!(list_dir(d.path(), true).unwrap().len(), 3);
        let a = shown.iter().find(|x| x.name == "a.txt").unwrap();
        assert_eq!((a.size, a.kind), (2, Kind::File));
        assert!(list_dir(&d.path().join("missing"), true).is_err());
    }
}
