//! Belge dosyası izleyici (2.x SSE `/api/watch` karşılığı).
//!
//! Dosyanın kendisi değil üst klasörü izlenir: atomik kaydeden editörler
//! (geçici dosya + yeniden adlandırma) dosya düzeyindeki izlemeyi koparır.
//! Olaylar dosya adına göre süzülür, 300 ms içinde birleştirilir; mtime
//! değişmediyse ya da değişiklik uygulamanın kendi kaydıysa bildirilmez.
use mdflow_core::paths::same_path;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::Duration;

const SETTLE: Duration = Duration::from_millis(300);

pub struct FileWatcher {
    _watcher: RecommendedWatcher,
}

impl FileWatcher {
    pub fn start(
        path: PathBuf,
        is_own_write: impl Fn(&Path, u64) -> bool + Send + 'static,
        on_change: impl Fn(PathBuf) + Send + 'static,
    ) -> notify::Result<FileWatcher> {
        let dir = path.parent().map(Path::to_path_buf).unwrap_or_else(|| path.clone());
        let (tx, rx) = mpsc::channel::<()>();
        let target = path.to_string_lossy().into_owned();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if let Ok(ev) = res {
                if ev.paths.iter().any(|p| same_path(&p.to_string_lossy(), &target)) {
                    let _ = tx.send(());
                }
            }
        })?;
        watcher.watch(&dir, RecursiveMode::NonRecursive)?;

        let mut last = mtime(&path);
        // İzleyici düşünce gönderici de düşer; recv hata verir ve iş parçacığı biter.
        std::thread::spawn(move || {
            while rx.recv().is_ok() {
                loop {
                    match rx.recv_timeout(SETTLE) {
                        Ok(()) => continue,
                        Err(RecvTimeoutError::Timeout) => break,
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                }
                let now = mtime(&path);
                if now.is_none() || now == last {
                    continue; // silinmiş/yeniden adlandırma ortası ya da gerçek değişiklik yok
                }
                last = now;
                let Ok(bytes) = std::fs::read(&path) else { continue };
                if is_own_write(&path, crate::api::hash_bytes(&bytes)) {
                    continue;
                }
                on_change(path.clone());
            }
        });
        Ok(FileWatcher { _watcher: watcher })
    }
}

fn mtime(p: &Path) -> Option<std::time::SystemTime> {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
}

/// Pencere başına tek izleyici; yenisi eskisinin yerini alır (eskisi düşer).
#[derive(Default)]
pub struct WatchState(pub Mutex<Option<FileWatcher>>);

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::Receiver;
    use tempfile::TempDir;

    const WAIT: Duration = Duration::from_secs(3);
    const QUIET: Duration = Duration::from_millis(1200);

    fn setup() -> (TempDir, PathBuf) {
        let t = TempDir::new().unwrap();
        let f = t.path().join("a.md");
        std::fs::write(&f, "ilk").unwrap();
        (t, f)
    }

    fn watch(f: &Path, own: impl Fn(&Path, u64) -> bool + Send + 'static) -> (FileWatcher, Receiver<PathBuf>) {
        let (tx, rx) = mpsc::channel();
        let w = FileWatcher::start(f.to_path_buf(), own, move |p| {
            let _ = tx.send(p);
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(200)); // izleyici kurulsun
        (w, rx)
    }

    /// mtime çözünürlüğü kaba olan dosya sistemlerinde yazmalar ayırt edilsin.
    fn pause() {
        std::thread::sleep(Duration::from_millis(50));
    }

    #[test]
    fn write_notifies_once() {
        let (_t, f) = setup();
        let (_w, rx) = watch(&f, |_, _| false);
        pause();
        std::fs::write(&f, "ikinci").unwrap();
        assert_eq!(rx.recv_timeout(WAIT).unwrap(), f);
        assert!(rx.recv_timeout(QUIET).is_err(), "tek yazma tek bildirim olmalı");
    }

    #[test]
    fn rename_replace_still_notifies() {
        let (t, f) = setup();
        let (_w, rx) = watch(&f, |_, _| false);
        pause();
        let tmp = t.path().join("a.md.tmp");
        std::fs::write(&tmp, "atomik").unwrap();
        std::fs::rename(&tmp, &f).unwrap();
        assert_eq!(rx.recv_timeout(WAIT).unwrap(), f);
        pause();
        std::fs::write(&f, "sonra").unwrap();
        assert_eq!(rx.recv_timeout(WAIT).unwrap(), f);
    }

    #[test]
    fn sibling_change_is_ignored() {
        let (t, f) = setup();
        let (_w, rx) = watch(&f, |_, _| false);
        std::fs::write(t.path().join("b.md"), "komşu").unwrap();
        assert!(rx.recv_timeout(QUIET).is_err());
    }

    #[test]
    fn drop_stops_notifications() {
        let (_t, f) = setup();
        let (w, rx) = watch(&f, |_, _| false);
        drop(w);
        pause();
        std::fs::write(&f, "sessiz").unwrap();
        assert!(rx.recv_timeout(QUIET).is_err());
    }

    #[test]
    fn own_write_is_not_notified() {
        let (_t, f) = setup();
        let own_hash = crate::api::hash_bytes(b"kendi kaydim");
        let (_w, rx) = watch(&f, move |_, h| h == own_hash);
        pause();
        std::fs::write(&f, "kendi kaydim").unwrap();
        assert!(rx.recv_timeout(QUIET).is_err(), "kendi kaydı bildirilmemeli");
        pause();
        std::fs::write(&f, "dis degisiklik").unwrap();
        assert_eq!(rx.recv_timeout(WAIT).unwrap(), f);
    }
}
