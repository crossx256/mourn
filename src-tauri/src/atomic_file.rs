//! Atomic publication of non-secret local metadata. Callers serialize read/modify/write.
use std::io::{self, Write};
use std::path::Path;

pub fn write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("missing parent"))?;
    std::fs::create_dir_all(parent)?;
    // NamedTempFile uses exclusive creation and 0600 on Unix. persist replaces
    // atomically on Windows as well; do not remove the destination first.
    let mut pending = tempfile::NamedTempFile::new_in(parent)?;
    pending.write_all(bytes)?;
    pending.as_file().sync_all()?;
    pending.persist(path).map_err(|error| error.error)?;
    #[cfg(unix)]
    std::fs::File::open(parent)?.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_existing_file_without_a_delete_gap() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index.json");
        write(&path, b"old").unwrap();
        write(&path, b"new").unwrap();
        assert_eq!(std::fs::read(path).unwrap(), b"new");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
