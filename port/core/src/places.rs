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

/// Home, the usual user folders that exist, then drives.
pub fn places() -> Vec<Place> {
    let mut out: Vec<Place> = [
        place("Home", dirs::home_dir(), "home"),
        place("Desktop", dirs::desktop_dir(), "folder"),
        place("Documents", dirs::document_dir(), "folder"),
        place("Downloads", dirs::download_dir(), "folder"),
        place("Pictures", dirs::picture_dir(), "folder"),
        place("Music", dirs::audio_dir(), "folder"),
        place("Videos", dirs::video_dir(), "folder"),
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
    fn mounts() {
        let text = "/dev/sda1 / ext4 rw 0 0\n/dev/sdb1 /media/me/USB\\040STICK vfat rw 0 0\ntmpfs /run/user/1000 tmpfs rw 0 0\n/dev/sdc1 /boot ext4 rw 0 0";
        let p = parse_mounts(text);
        assert_eq!(p.len(), 2);
        assert_eq!(p[1].name, "USB STICK");
        assert_eq!(p[1].path, "/media/me/USB STICK");
    }
}
