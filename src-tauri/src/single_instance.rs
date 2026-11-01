//! Linux uses a per-user private Unix socket, not a globally claimable TCP port.
//! The non-Linux implementation is unchanged and needs separate platform review.
#[cfg(not(target_os = "linux"))]
#[path = "single_instance_tcp.rs"]
mod platform;

#[cfg(target_os = "linux")]
mod platform {
    use std::fs::{self, File, OpenOptions};
    use std::io::{Read, Write};
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt};
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    const TOKEN: &[u8] = b"MOURN-RAISE-2";
    const ACK: &[u8] = b"OK";
    const TIMEOUT: Duration = Duration::from_millis(750);

    pub struct Listener {
        socket: UnixListener,
        _lock: File,
        path: PathBuf,
    }
    impl Drop for Listener {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.path);
        }
    }
    pub enum Claim {
        Primary(Listener),
        Secondary,
        Unguarded,
    }
    fn private_directory(path: &Path, uid: u32) -> std::io::Result<()> {
        match fs::create_dir(path) {
            Ok(()) => fs::set_permissions(path, fs::Permissions::from_mode(0o700))?,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
            Err(e) => return Err(e),
        }
        let meta = fs::symlink_metadata(path)?;
        if !meta.is_dir()
            || meta.file_type().is_symlink()
            || meta.uid() != uid
            || meta.mode() & 0o077 != 0
        {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "unsafe instance directory",
            ));
        }
        Ok(())
    }
    fn ask(path: &Path) -> bool {
        let Ok(mut stream) = UnixStream::connect(path) else {
            return false;
        };
        let _ = stream.set_read_timeout(Some(TIMEOUT));
        let _ = stream.set_write_timeout(Some(TIMEOUT));
        if stream.write_all(TOKEN).is_err() {
            return false;
        }
        let mut ack = [0u8; ACK.len()];
        stream.read_exact(&mut ack).is_ok() && ack == ACK
    }
    fn claim_at(runtime: &Path) -> std::io::Result<Claim> {
        // SAFETY: geteuid has no arguments and no memory safety preconditions.
        let uid = unsafe { libc::geteuid() };
        let meta = fs::symlink_metadata(runtime)?;
        if !runtime.is_absolute()
            || !meta.is_dir()
            || meta.file_type().is_symlink()
            || meta.uid() != uid
            || meta.mode() & 0o022 != 0
        {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "unsafe runtime directory",
            ));
        }
        let dir = runtime.join("bio.mourn.desktop-instance");
        private_directory(&dir, uid)?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(dir.join("lock"))?;
        let meta = lock.metadata()?;
        if !meta.is_file() || meta.uid() != uid || meta.mode() & 0o077 != 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "unsafe instance lock",
            ));
        }
        let path = dir.join("raise.sock");
        // SAFETY: the descriptor is owned and alive. flock only locks the file;
        // the File remains owned by Listener until the primary process exits.
        if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            return Ok(if ask(&path) {
                Claim::Secondary
            } else {
                Claim::Unguarded
            });
        }
        if let Ok(meta) = fs::symlink_metadata(&path) {
            if !meta.file_type().is_socket() || meta.uid() != uid {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "unsafe instance socket",
                ));
            }
            // Only the flock owner can remove a stale socket after a crash.
            fs::remove_file(&path)?;
        }
        let socket = UnixListener::bind(&path)?;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
        Ok(Claim::Primary(Listener {
            socket,
            _lock: lock,
            path,
        }))
    }
    pub fn claim() -> Claim {
        std::env::var_os("XDG_RUNTIME_DIR")
            .and_then(|dir| claim_at(Path::new(&dir)).ok())
            .unwrap_or(Claim::Unguarded)
    }
    pub fn spawn_raise_server<F: Fn() + Send + 'static>(listener: Listener, on_raise: F) {
        std::thread::spawn(move || {
            for incoming in listener.socket.incoming() {
                let Ok(mut stream) = incoming else { continue };
                let _ = stream.set_read_timeout(Some(TIMEOUT));
                let _ = stream.set_write_timeout(Some(TIMEOUT));
                let mut token = [0u8; TOKEN.len()];
                if stream.read_exact(&mut token).is_ok() && token == TOKEN {
                    if stream.write_all(ACK).is_ok() {
                        on_raise();
                    }
                }
            }
        });
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn claims_use_private_directories_and_release_locks() {
            let dir = tempfile::tempdir().unwrap();
            fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
            let first = claim_at(dir.path()).unwrap();
            assert!(matches!(first, Claim::Primary(_)));
            drop(first);
            assert!(matches!(claim_at(dir.path()).unwrap(), Claim::Primary(_)));
            fs::set_permissions(
                dir.path().join("bio.mourn.desktop-instance"),
                fs::Permissions::from_mode(0o777),
            )
            .unwrap();
            assert!(claim_at(dir.path()).is_err());
        }
    }
}
pub use platform::{claim, spawn_raise_server, Claim};
