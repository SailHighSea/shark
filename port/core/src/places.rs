use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Place {
    pub name: String,
    pub path: String,
    /// "home", "folder" or "drive"; the UI picks the icon from it.
    pub kind: &'static str,
}

fn place(name: &str, path: Option<PathBuf>, kind: &'static str) -> Option<Place> {
    let path = path.filter(|p| p.is_dir())?;
    Some(Place { name: name.into(), path: path.to_string_lossy().into_owned(), kind })
}

/// Mount points from `/proc/mounts` text that a user would call a drive.
pub fn parse_mounts(text: &str) -> Vec<Place> {
    let mut out = vec![Place { name: "Computer".into(), path: "/".into(), kind: "drive" }];
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        let (Some(dev), Some(mount)) = (parts.next(), parts.next()) else { continue };
        let mount = mount.replace("\\040", " ");
        let removable = mount.starts_with("/media/") || mount.starts_with("/run/media/") || mount.starts_with("/mnt/");
        if dev.starts_with("/dev/") && removable {
            let name = mount.rsplit('/').next().unwrap_or(&mount).to_string();
            out.push(Place { name, path: mount, kind: "drive" });
        }
    }
    out
}

fn drives() -> Vec<Place> {
    #[cfg(windows)]
    {
        ('A'..='Z')
            .map(|c| format!("{c}:\\"))
            .filter(|p| std::path::Path::new(p).exists())
            .map(|p| Place { name: p.clone(), path: p, kind: "drive" })
            .collect()
    }
    #[cfg(not(windows))]
    {
        std::fs::read_to_string("/proc/mounts").map(|t| parse_mounts(&t)).unwrap_or_default()
    }
}

/// The configured folder, or `~/<name>` when the system has no user-dirs setup
/// (minimal Linux installs, containers) but the folder exists.
fn user_dir(configured: Option<PathBuf>, home: &Option<PathBuf>, name: &str) -> Option<PathBuf> {
    configured.or_else(|| home.as_ref().map(|h| h.join(name)))
}

/// Home, the usual user folders that exist, then drives.
pub fn places() -> Vec<Place> {
    let home = dirs::home_dir();
    let mut out: Vec<Place> = [
        place("Home", home.clone(), "home"),
        place("Desktop", user_dir(dirs::desktop_dir(), &home, "Desktop"), "folder"),
        place("Documents", user_dir(dirs::document_dir(), &home, "Documents"), "folder"),
        place("Downloads", user_dir(dirs::download_dir(), &home, "Downloads"), "folder"),
        place("Pictures", user_dir(dirs::picture_dir(), &home, "Pictures"), "folder"),
        place("Music", user_dir(dirs::audio_dir(), &home, "Music"), "folder"),
        place("Videos", user_dir(dirs::video_dir(), &home, "Videos"), "folder"),
    ]
    .into_iter()
    .flatten()
    .collect();
    out.extend(drives());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn falls_back_to_home_subfolder() {
        let home = Some(PathBuf::from("/h"));
        assert_eq!(user_dir(None, &home, "Documents"), Some(PathBuf::from("/h/Documents")));
        assert_eq!(user_dir(Some("/x".into()), &home, "Documents"), Some(PathBuf::from("/x")));
        assert_eq!(user_dir(None, &None, "Documents"), None);
    }

    #[test]
    fn mounts() {
        let text = "/dev/sda1 / ext4 rw 0 0\n/dev/sdb1 /media/me/USB\\040STICK vfat rw 0 0\ntmpfs /run/user/1000 tmpfs rw 0 0\n/dev/sdc1 /boot ext4 rw 0 0";
        let p = parse_mounts(text);
        assert_eq!(p.len(), 2);
        assert_eq!(p[1].name, "USB STICK");
        assert_eq!(p[1].path, "/media/me/USB STICK");
    }
}
