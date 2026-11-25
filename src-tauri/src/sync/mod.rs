//! Telefon ↔ bilgisayar not eşitlemesi: sunucusuz, hesapsız, yerel ağda.
//!
//! Bilgisayar dinler (yalnız kullanıcı açarsa), telefon bağlanır ve eşitlemeyi
//! yürütür; kararlar `mdflow_core::sync` içindedir. Yalnız özel ağ adreslerinden
//! (ve Tailscale gibi 100.64/10 ağlarından) gelen bağlantılar kabul edilir.
mod channel;
mod store;

use channel::{bad, hex, random, read_frame, unhex32, write_frame, Channel, PairFail};
use mdflow_core::sync::{self as core, HashCache, Manifest, Op};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::{self, ErrorKind};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use store::{Link, Peer, Store};

pub const PORT: u16 = 47823;
const HELLO: &[u8] = b"MDFLOW?1";
const CODE_LIFE: Duration = Duration::from_secs(300);
const CODE_TRIES: u32 = 5;
const MAX_CONNECTIONS: usize = 8;

type Notify = Box<dyn Fn(&str) + Send + Sync>;

struct Pairing {
    code: String,
    until: Instant,
    tries: u32,
}

struct Server {
    stop: Arc<AtomicBool>,
    port: u16,
}

pub struct SyncState {
    store: Mutex<Store>,
    pairing: Mutex<Option<Pairing>>,
    server: Mutex<Option<Server>>,
    cache: Mutex<HashCache>,
    /// Klasöre yazan işler sırayla (istemci eşitlemesi ve gelen yazmalar).
    files: Mutex<()>,
    running: AtomicBool,
    /// Arayüzde o an düzenlenen not.
    busy: Mutex<Option<PathBuf>>,
    notify: Notify,
    port: u16,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// Yerel ağ dışından bağlantı alınmaz. 100.64/10: Tailscale ve benzerleri.
fn is_private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(a) => {
            let o = a.octets();
            a.is_private() || a.is_loopback() || a.is_link_local() || (o[0] == 100 && o[1] & 0xc0 == 64)
        }
        IpAddr::V6(_) => false,
    }
}

/// Telefonun ulaşabileceği adresler (sanal köprüler hariç).
fn local_addrs() -> Vec<String> {
    let mut v: Vec<(bool, String)> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|i| !i.is_loopback() && !["docker", "br-", "veth", "virbr", "vmnet", "vEthernet"].iter().any(|p| i.name.starts_with(p)))
        .filter_map(|i| match i.ip() {
            ip @ IpAddr::V4(a) if is_private(ip) && !a.is_link_local() => Some((a.octets()[0] == 100, a.to_string())),
            _ => None,
        })
        .collect();
    v.sort();
    v.into_iter().map(|(_, a)| a).collect()
}

fn device_name() -> String {
    let name = std::env::var("COMPUTERNAME")
        .ok()
        .or_else(|| std::fs::read_to_string("/etc/hostname").ok())
        .or_else(|| std::env::var("HOSTNAME").ok())
        .unwrap_or_default();
    clean_name(if name.trim().is_empty() { "Bilgisayar" } else { &name })
}

fn clean_name(name: &str) -> String {
    name.chars().filter(|c| !c.is_control()).take(40).collect::<String>().trim().to_string()
}

fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}

fn check_folder(folder: &str) -> Result<PathBuf, String> {
    let p = Path::new(folder);
    if folder.is_empty() || !p.is_absolute() || !p.is_dir() {
        return Err("Önce bir eşitleme klasörü seçin.".into());
    }
    let real = std::fs::canonicalize(p).map_err(|e| e.to_string())?;
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).and_then(|h| std::fs::canonicalize(h).ok());
    if real.parent().is_none() || home.is_some_and(|h| h.starts_with(&real)) || real == Path::new("/storage/emulated/0") {
        return Err("Bu klasör eşitlemek için çok geniş; içinde bir not klasörü seçin.".into());
    }
    Ok(p.to_path_buf())
}

fn connect(addr: SocketAddr) -> io::Result<TcpStream> {
    let s = TcpStream::connect_timeout(&addr, Duration::from_millis(2500))?;
    s.set_nodelay(true)?;
    s.set_read_timeout(Some(Duration::from_secs(15)))?;
    s.set_write_timeout(Some(Duration::from_secs(30)))?;
    Ok(s)
}

/// "192.168.1.5" ya da "192.168.1.5:47823"
fn parse_addr(s: &str) -> Result<SocketAddr, String> {
    let s = s.trim();
    let addr = s.parse::<SocketAddr>().ok().or_else(|| s.parse::<Ipv4Addr>().ok().map(|a| SocketAddr::from((a, PORT))));
    match addr {
        Some(a) if is_private(a.ip()) => Ok(a),
        Some(_) => Err("Bu adres yerel ağda değil.".into()),
        None => Err("Adres geçersiz. Örnek: 192.168.1.5".into()),
    }
}

/// Eşleştirme hatası; `at` arayüzün hangi adımı işaretleyeceğini söyler:
/// addr, folder, code, closed (kod beklenmiyor), off (eşitleme kapalı),
/// timeout, network, denied, host.
#[derive(Debug)]
pub struct PairError {
    at: &'static str,
    msg: String,
}

impl PairError {
    fn new(at: &'static str, msg: impl Into<String>) -> PairError {
        PairError { at, msg: msg.into() }
    }

    pub fn json(&self) -> Value {
        json!({"success": false, "error": self.msg, "at": self.at})
    }
}

fn unreachable(e: &io::Error, addr: SocketAddr) -> PairError {
    let ip = addr.ip();
    match e.kind() {
        ErrorKind::ConnectionRefused => PairError::new("off", format!("{ip} açık ama MD Flow orada dinlemiyor.")),
        ErrorKind::PermissionDenied => PairError::new("denied", "Yerel ağa erişim izni yok."),
        ErrorKind::NetworkUnreachable | ErrorKind::NetworkDown | ErrorKind::AddrNotAvailable => {
            PairError::new("network", format!("Bu aygıtın bulunduğu ağdan {ip} adresine gidilemiyor."))
        }
        _ => PairError::new("timeout", format!("{ip} yanıt vermedi.")),
    }
}

impl SyncState {
    pub fn new(path: PathBuf, port: u16, notify: impl Fn(&str) + Send + Sync + 'static) -> Arc<SyncState> {
        Arc::new(SyncState {
            store: Mutex::new(Store::open(path)),
            pairing: Mutex::new(None),
            server: Mutex::new(None),
            cache: Mutex::new(HashCache::default()),
            files: Mutex::new(()),
            running: AtomicBool::new(false),
            busy: Mutex::new(None),
            notify: Box::new(notify),
            port,
        })
    }

    pub fn set_busy(&self, path: Option<String>) {
        *lock(&self.busy) = path.filter(|p| !p.is_empty()).map(PathBuf::from);
    }

    fn busy_in(&self, root: &Path) -> Option<String> {
        let busy = lock(&self.busy).clone()?;
        let real = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
        let (busy, root) = (real(&busy), real(root));
        let rel = busy.strip_prefix(&root).ok()?;
        Some(rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"))
    }

    fn manifest(&self, root: &Path) -> Result<Manifest, String> {
        let mut m = core::scan(root, &mut lock(&self.cache))?;
        m.busy.extend(self.busy_in(root));
        Ok(m)
    }

    /// Arayüzün gördüğü durum; anahtar içermez.
    pub fn status(&self) -> Value {
        let pairing = {
            let mut g = lock(&self.pairing);
            if g.as_ref().is_some_and(|p| p.until <= Instant::now()) {
                *g = None;
            }
            g.as_ref().map(|p| json!({"code": p.code, "seconds": p.until.saturating_duration_since(Instant::now()).as_secs(), "tries": p.tries}))
        };
        let listening = lock(&self.server).as_ref().map(|s| s.port);
        let g = lock(&self.store);
        let d = &g.data;
        json!({
            "success": true,
            "name": device_name(),
            "addrs": local_addrs(),
            "port": listening.unwrap_or(self.port),
            "running": self.running.load(Ordering::SeqCst),
            "host": {
                "enabled": d.host.enabled,
                "listening": listening.is_some(),
                "folder": d.host.folder,
                "pairing": pairing,
                "peers": d.host.peers.iter().map(|p| json!({"id": p.id, "name": p.name, "last": p.last})).collect::<Vec<_>>(),
            },
            "link": d.link.as_ref().map(|l| json!({
                "name": l.name, "folder": l.folder, "auto": l.auto, "last": l.last,
            })),
        })
    }

    // --- bilgisayar tarafı ------------------------------------------------------

    /// Açılışta: kullanıcı açık bıraktıysa dinlemeye başlar.
    pub fn resume(self: &Arc<Self>) {
        if lock(&self.store).data.host.enabled {
            if let Err(e) = self.listen() {
                eprintln!("eşitleme başlatılamadı: {e}");
            }
        }
    }

    pub fn set_host(self: &Arc<Self>, enabled: bool, folder: Option<String>) -> Result<Value, String> {
        {
            let mut g = lock(&self.store);
            let h = &mut g.data.host;
            if let Some(f) = folder {
                check_folder(&f)?;
                if h.folder != f || h.folder_id.is_empty() {
                    h.folder = f;
                    h.folder_id = hex(&random::<16>());
                }
            }
            if enabled {
                check_folder(&h.folder)?;
            }
            h.enabled = enabled;
            g.save().map_err(|e| e.to_string())?;
        }
        if enabled {
            if let Err(e) = self.listen() {
                let mut g = lock(&self.store);
                g.data.host.enabled = false;
                let _ = g.save();
                return Err(e);
            }
        } else {
            self.stop();
        }
        Ok(self.status())
    }

    fn stop(&self) {
        *lock(&self.pairing) = None;
        if let Some(s) = lock(&self.server).take() {
            s.stop.store(true, Ordering::SeqCst);
        }
    }

    fn listen(self: &Arc<Self>) -> Result<(), String> {
        let mut slot = lock(&self.server);
        if slot.is_some() {
            return Ok(());
        }
        let any = Ipv4Addr::UNSPECIFIED;
        // Az önce kapatılan dinleyici kapıyı birkaç yüz ms daha tutabilir.
        let listener = (0..5)
            .find_map(|i| {
                std::thread::sleep(Duration::from_millis(100 * i));
                TcpListener::bind((any, self.port)).ok()
            })
            .ok_or("Eşitleme kapısı açılamadı; uygulamanın başka bir penceresi açık olabilir.")?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let stop = Arc::new(AtomicBool::new(false));

        let (me, flag) = (self.clone(), stop.clone());
        std::thread::spawn(move || {
            let open = Arc::new(AtomicUsize::new(0));
            while !flag.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((s, from)) => {
                        if !is_private(from.ip()) || open.load(Ordering::SeqCst) >= MAX_CONNECTIONS {
                            continue;
                        }
                        open.fetch_add(1, Ordering::SeqCst);
                        let (me, open, flag) = (me.clone(), open.clone(), flag.clone());
                        std::thread::spawn(move || {
                            let _ = me.serve(s, &flag);
                            open.fetch_sub(1, Ordering::SeqCst);
                        });
                    }
                    Err(_) => std::thread::sleep(Duration::from_millis(150)),
                }
            }
        });

        // Keşif isteğe bağlıdır: kapı doluysa telefon adresle de bağlanabilir.
        if let Ok(udp) = UdpSocket::bind((any, port)) {
            let (me, flag) = (self.clone(), stop.clone());
            let _ = udp.set_read_timeout(Some(Duration::from_millis(400)));
            std::thread::spawn(move || {
                let mut buf = [0u8; 64];
                while !flag.load(Ordering::SeqCst) {
                    match udp.recv_from(&mut buf) {
                        Ok((n, from)) if &buf[..n] == HELLO && is_private(from.ip()) => {
                            let id = lock(&me.store).data.device_id.clone();
                            let reply = json!({"app": "mdflow", "id": id, "name": device_name(), "port": port}).to_string();
                            let _ = udp.send_to(reply.as_bytes(), from);
                        }
                        Ok(_) => {}
                        Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
                        Err(_) => std::thread::sleep(Duration::from_millis(200)),
                    }
                }
            });
        }
        *slot = Some(Server { stop, port });
        Ok(())
    }

    pub fn pair_start(&self) -> Result<Value, String> {
        if lock(&self.server).is_none() {
            return Err("Önce eşitlemeyi açın.".into());
        }
        let n = u64::from_be_bytes(random::<8>()) % 100_000_000;
        *lock(&self.pairing) = Some(Pairing { code: format!("{n:08}"), until: Instant::now() + CODE_LIFE, tries: CODE_TRIES });
        Ok(self.status())
    }

    pub fn pair_stop(&self) -> Value {
        *lock(&self.pairing) = None;
        self.status()
    }

    pub fn remove_peer(&self, id: &str) -> Result<Value, String> {
        {
            let mut g = lock(&self.store);
            g.data.host.peers.retain(|p| p.id != id);
            g.save().map_err(|e| e.to_string())?;
        }
        Ok(self.status())
    }

    fn serve(self: &Arc<Self>, mut s: TcpStream, stop: &AtomicBool) -> io::Result<()> {
        s.set_nonblocking(false)?;
        s.set_nodelay(true)?;
        s.set_read_timeout(Some(Duration::from_secs(10)))?;
        s.set_write_timeout(Some(Duration::from_secs(30)))?;
        let first = read_frame(&mut s)?;
        if first == b"PAIR" {
            return self.serve_pair(s);
        }
        let id = String::from_utf8(first).map_err(|_| bad("Bozuk istek."))?;
        let key = lock(&self.store).data.host.peers.iter().find(|p| p.id == id).and_then(|p| unhex32(&p.key));
        let key = key.ok_or_else(|| bad("Eşleştirilmemiş aygıt."))?;
        let mut ch = Channel::accept(s, &key)?;
        // İstemci dosyaları arka arkaya ister; arada yerel işi olabilir.
        ch.set_timeout(Duration::from_secs(60))?;
        let mut wrote = false;
        let result = loop {
            let (req, body) = match ch.recv() {
                Ok(v) => v,
                Err(e) => break Err(e),
            };
            // Kaldırılan aygıtın ya da kapatılan eşitlemenin açık bağlantısı da kesilir.
            if stop.load(Ordering::SeqCst) || !lock(&self.store).data.host.peers.iter().any(|p| p.id == id) {
                break Err(bad("Eşleştirme kaldırıldı."));
            }
            if text(&req, "op") == "done" {
                let _ = ch.send(&json!({"ok": true}), &[]);
                break Ok(());
            }
            let (head, out) = match self.answer(&id, &req, &body) {
                Ok(v) => v,
                Err(e) => (json!({"error": e.to_string()}), Vec::new()),
            };
            wrote |= matches!(text(&req, "op"), "put" | "del") && head["ok"] == true;
            if let Err(e) = ch.send(&head, &out) {
                break Err(e);
            }
            if text(&req, "op") == "forget" {
                break Ok(());
            }
        };
        if result.is_ok() {
            let mut g = lock(&self.store);
            if let Some(p) = g.data.host.peers.iter_mut().find(|p| p.id == id) {
                p.last = now();
            }
            let _ = g.save();
        }
        (self.notify)(if wrote { "files" } else { "status" });
        result
    }

    fn serve_pair(&self, s: TcpStream) -> io::Result<()> {
        let code = {
            let mut g = lock(&self.pairing);
            let code = match g.as_mut() {
                // Deneme hakkı baştan düşülür: yarıda kesilen deneme de sayılır.
                Some(p) if p.until > Instant::now() && p.tries > 0 => {
                    p.tries -= 1;
                    Some(p.code.clone())
                }
                _ => None,
            };
            if code.is_none() {
                *g = None;
            }
            code
        };
        let code = code.ok_or_else(|| bad("Eşleştirme açık değil."))?;
        (self.notify)("pair-try");
        let opened = channel::pair_accept(s, &code).and_then(|mut ch| ch.recv().map(|(req, _)| (ch, req)));
        let (mut ch, req) = match opened {
            Ok(v) => v,
            Err(e) => {
                // Hakkı biten kod ekranda geçerliymiş gibi kalmasın.
                let over = lock(&self.pairing).take_if(|p| p.code == code && p.tries == 0).is_some();
                let wrong = e.kind() == ErrorKind::InvalidData;
                (self.notify)(if over { "pair-over" } else if wrong { "pair-bad" } else { "pair-lost" });
                return Err(e);
            }
        };
        // Aynı kodla ikinci aygıt eşleşemez.
        if lock(&self.pairing).take_if(|p| p.code == code).is_none() {
            return Err(bad("Eşleştirme kapandı."));
        }
        let id = text(&req, "id").to_string();
        if id.len() != 32 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(bad("Bozuk istek."));
        }
        let name = clean_name(text(&req, "name"));
        let key = random::<32>();
        let reply = {
            let mut g = lock(&self.store);
            g.data.host.peers.retain(|p| p.id != id);
            let name = if name.is_empty() { "Telefon".into() } else { name };
            g.data.host.peers.push(Peer { id, name, key: hex(&key), last: 0 });
            g.save()?;
            json!({"id": g.data.device_id, "name": device_name(), "key": hex(&key), "addrs": local_addrs()})
        };
        ch.send(&reply, &[])?;
        (self.notify)("paired");
        Ok(())
    }

    fn answer(&self, peer: &str, req: &Value, body: &[u8]) -> io::Result<(Value, Vec<u8>)> {
        let ok = || (json!({"ok": true}), Vec::new());
        let (folder, folder_id) = {
            let g = lock(&self.store);
            (g.data.host.folder.clone(), g.data.host.folder_id.clone())
        };
        if text(req, "op") == "forget" {
            let mut g = lock(&self.store);
            g.data.host.peers.retain(|p| p.id != peer);
            g.save()?;
            return Ok(ok());
        }
        let root = check_folder(&folder).map_err(io::Error::other)?;
        // Oturum ortasında klasör değiştiyse eski plan yeni klasöre uygulanmaz.
        if text(req, "op") != "list" && text(req, "folder") != folder_id {
            return Err(io::Error::other("Bilgisayardaki eşitleme klasörü değişti; yeniden deneyin."));
        }
        let path = text(req, "path");
        let guard = || -> io::Result<()> {
            if self.busy_in(&root).as_deref() == Some(path) {
                return Err(io::Error::other("Not bilgisayarda düzenleniyor."));
            }
            Ok(())
        };
        match text(req, "op") {
            "list" => {
                let m = self.manifest(&root).map_err(io::Error::other)?;
                let head = json!({"ok": true, "folder": folder_id, "addrs": local_addrs(), "name": device_name()});
                Ok((head, serde_json::to_vec(&m)?))
            }
            "get" => Ok((json!({"ok": true}), core::read(&root, path, text(req, "hash"))?)),
            "put" => {
                let _files = lock(&self.files);
                guard()?;
                core::write(&root, path, req["expect"].as_str(), body)?;
                Ok(ok())
            }
            "del" => {
                let _files = lock(&self.files);
                guard()?;
                core::trash(&root, path, text(req, "expect"))?;
                Ok(ok())
            }
            _ => Err(bad("Bilinmeyen istek.")),
        }
    }

    // --- telefon tarafı ---------------------------------------------------------

    /// Yerel ağdaki açık bilgisayarlar.
    pub fn discover(&self) -> Vec<Value> {
        let Ok(udp) = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)) else { return Vec::new() };
        let _ = udp.set_broadcast(true);
        let _ = udp.set_read_timeout(Some(Duration::from_millis(200)));
        let mut targets = vec![Ipv4Addr::BROADCAST];
        for i in if_addrs::get_if_addrs().unwrap_or_default() {
            if let if_addrs::IfAddr::V4(a) = i.addr {
                targets.extend(a.broadcast.filter(|_| !i.name.starts_with("docker") && !i.name.starts_with("br-")));
            }
        }
        let targets: Vec<SocketAddr> = targets.into_iter().map(|t| (t, self.port).into()).collect();
        Self::ask(&udp, &targets, false)
    }

    /// Adresleri yoklar; `first` ise ilk yanıtta döner.
    fn ask(udp: &UdpSocket, targets: &[SocketAddr], first: bool) -> Vec<Value> {
        let start = Instant::now();
        let mut sent = 0;
        let mut seen = HashSet::new();
        let mut found = Vec::new();
        let mut buf = [0u8; 512];
        while start.elapsed() < Duration::from_millis(1800) {
            if start.elapsed() >= Duration::from_millis(600 * sent) && sent < 3 {
                for t in targets {
                    let _ = udp.send_to(HELLO, t);
                }
                sent += 1;
            }
            let Ok((n, from)) = udp.recv_from(&mut buf) else { continue };
            let Ok(v) = serde_json::from_slice::<Value>(&buf[..n]) else { continue };
            let (id, port) = (text(&v, "id").to_string(), v["port"].as_u64().and_then(|p| u16::try_from(p).ok()));
            let Some(port) = port else { continue };
            if v["app"] == "mdflow" && is_private(from.ip()) && found.len() < 20 && seen.insert((id.clone(), from.ip())) {
                let addr = SocketAddr::new(from.ip(), port).to_string();
                found.push(json!({"id": id, "name": clean_name(text(&v, "name")), "addr": addr}));
                if first {
                    break;
                }
            }
        }
        found
    }

    /// Yazılan adreste eşitleme açık mı? Eşleştirme hakkı harcamaz.
    pub fn check(&self, addr: &str) -> Result<Value, PairError> {
        let addr = parse_addr(addr).map_err(|e| PairError::new("addr", e))?;
        connect(addr).map_err(|e| unreachable(&e, addr))?;
        let name = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok().and_then(|udp| {
            let _ = udp.set_read_timeout(Some(Duration::from_millis(200)));
            Self::ask(&udp, &[addr], true).first().map(|v| text(v, "name").to_string())
        });
        Ok(json!({"success": true, "name": name.unwrap_or_default()}))
    }

    pub fn pair(&self, addr: &str, code: &str, name: &str, folder: &str) -> Result<Value, PairError> {
        let addr = parse_addr(addr).map_err(|e| PairError::new("addr", e))?;
        check_folder(folder).map_err(|e| PairError::new("folder", e))?;
        let code: String = code.chars().filter(char::is_ascii_digit).collect();
        if code.len() != 8 {
            return Err(PairError::new("code", "Kod 8 haneli olmalı."));
        }
        let s = connect(addr).map_err(|e| unreachable(&e, addr))?;
        (self.notify)("pair-verify");
        let mut ch = channel::pair_connect(s, &code).map_err(|e| match e {
            PairFail::Closed => PairError::new("closed", "Bilgisayara ulaşıldı ama geçerli bir kod beklemiyor. Kodun süresi dolmuş ya da kod kullanılmış olabilir."),
            PairFail::Silent => PairError::new("host", "Bilgisayara bağlanıldı ama yanıt gelmedi."),
            PairFail::Code => PairError::new("code", "Kod yanlış. Bilgisayarda görünen kodu yeniden yaz."),
        })?;
        let wrong = |_: io::Error| PairError::new("host", "Kod doğru ama bağlantı yarıda kesildi.");
        let id = lock(&self.store).data.device_id.clone();
        ch.send(&json!({"id": id, "name": clean_name(name)}), &[]).map_err(wrong)?;
        let (r, _) = ch.recv().map_err(wrong)?;
        let key = text(&r, "key");
        unhex32(key).ok_or_else(|| PairError::new("host", "Eşleşme olmadı."))?;
        let mut addrs = vec![addr.to_string()];
        add_addrs(&mut addrs, &r, addr.port());
        {
            let mut g = lock(&self.store);
            g.data.link = Some(Link {
                host_id: text(&r, "id").into(),
                name: clean_name(text(&r, "name")),
                key: key.into(),
                addrs,
                folder: folder.into(),
                auto: true,
                ..Default::default()
            });
            g.save().map_err(|e| PairError::new("folder", e.to_string()))?;
        }
        Ok(self.status())
    }

    pub fn set_link(&self, folder: Option<String>, auto: Option<bool>) -> Result<Value, String> {
        {
            let mut g = lock(&self.store);
            let link = g.data.link.as_mut().ok_or("Bağlı bilgisayar yok.")?;
            if let Some(f) = folder {
                check_folder(&f)?;
                if link.folder != f {
                    link.folder = f;
                    link.base.clear();
                    link.folder_id.clear();
                }
            }
            if let Some(a) = auto {
                link.auto = a;
            }
            g.save().map_err(|e| e.to_string())?;
        }
        Ok(self.status())
    }

    /// Bağlantıyı kaldırır; bilgisayara ulaşılıyorsa o da bu aygıtı unutur.
    pub fn unlink(&self) -> Result<Value, String> {
        let link = lock(&self.store).data.link.clone();
        if let Some(link) = link {
            if let Ok((mut ch, _)) = self.open_link(&link) {
                let _ = ch.send(&json!({"op": "forget"}), &[]).and_then(|_| ch.recv());
            }
        }
        {
            let mut g = lock(&self.store);
            g.data.link = None;
            g.save().map_err(|e| e.to_string())?;
        }
        Ok(self.status())
    }

    /// Bilinen adresleri, olmazsa ağda keşfi dener.
    fn open_link(&self, link: &Link) -> Result<(Channel, String), String> {
        let key = unhex32(&link.key).ok_or("Eşleştirme bozuk; yeniden eşleştirin.")?;
        let id = lock(&self.store).data.device_id.clone();
        let mut reached = false;
        let mut attempt = |a: &str| -> Option<(Channel, String)> {
            let addr = parse_addr(a).ok()?;
            let mut s = connect(addr).ok()?;
            reached = true;
            write_frame(&mut s, id.as_bytes()).ok()?;
            let ch = Channel::connect(s, &key).ok()?;
            ch.set_timeout(Duration::from_secs(60)).ok()?;
            Some((ch, addr.to_string()))
        };
        for a in &link.addrs {
            if let Some(c) = attempt(a) {
                return Ok(c);
            }
        }
        for d in self.discover() {
            if text(&d, "id") == link.host_id && !link.addrs.iter().any(|a| a == text(&d, "addr")) {
                if let Some(c) = attempt(text(&d, "addr")) {
                    return Ok(c);
                }
            }
        }
        Err(if reached {
            "Bilgisayar bu aygıtı tanımadı. Eşitleme kapatılmış ya da eşleştirme kaldırılmış olabilir.".into()
        } else {
            format!("{} bulunamadı. Bilgisayarda MD Flow açık ve aynı ağda olmalı.", link.name)
        })
    }

    pub fn sync_now(&self, allow_deletes: bool) -> Result<Value, String> {
        if self.running.swap(true, Ordering::SeqCst) {
            return Ok(json!({"success": true, "busy": true}));
        }
        struct Running<'a>(&'a AtomicBool);
        impl Drop for Running<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::SeqCst);
            }
        }
        let _running = Running(&self.running);
        let link = lock(&self.store).data.link.clone().ok_or("Bağlı bilgisayar yok.")?;
        let root = check_folder(&link.folder)?;
        let (mut ch, addr) = self.open_link(&link)?;
        let mut call = |head: Value, body: &[u8]| -> Result<(Value, Vec<u8>), CallError> {
            ch.send(&head, body).and_then(|_| ch.recv()).map_err(|_| CallError::Lost).and_then(|(r, b)| {
                if r["ok"] == true {
                    Ok((r, b))
                } else {
                    Err(CallError::Refused(text(&r, "error").to_string()))
                }
            })
        };
        let (hello, body) = call(json!({"op": "list"}), &[]).map_err(CallError::message)?;
        let remote: Manifest = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
        let folder_id = text(&hello, "folder").to_string();
        let base = if link.folder_id == folder_id { link.base.clone() } else { Default::default() };
        let local = self.manifest(&root)?;
        let plan = core::plan(&base, &local, &remote);
        if !allow_deletes && plan.mass_delete(&base, &local, &remote) {
            return Ok(json!({"success": true, "confirm": true, "deletes": plan.deletes()}));
        }

        let mut base = plan.base;
        let (mut down, mut up, mut removed, mut conflicts) = (0, 0, 0, 0);
        let mut failed: Vec<String> = Vec::new();
        let mut lost = None;
        let mut told = Instant::now();
        for (i, (op, p)) in plan.ops.iter().enumerate() {
            if i == 0 || told.elapsed() >= Duration::from_millis(150) {
                told = Instant::now();
                (self.notify)(&format!("progress:{}/{}", i + 1, plan.ops.len()));
            }
            let (l, r) = (local.files.get(p), remote.files.get(p));
            let mut step = || -> Result<Option<String>, CallError> {
                match op {
                    Op::Pull => {
                        let h = r.cloned().unwrap_or_default();
                        let (_, bytes) = call(json!({"op": "get", "folder": folder_id, "path": p, "hash": h}), &[])?;
                        if core::hash(&bytes) != h {
                            return Err(CallError::Refused("Bozuk veri.".into()));
                        }
                        self.local_write(&root, p, l.map(String::as_str), &bytes)?;
                        down += 1;
                        Ok(Some(h))
                    }
                    Op::Push => {
                        let h = l.cloned().unwrap_or_default();
                        let bytes = core::read(&root, p, &h)?;
                        call(json!({"op": "put", "folder": folder_id, "path": p, "expect": r}), &bytes)?;
                        up += 1;
                        Ok(Some(h))
                    }
                    Op::DeleteLocal => {
                        let _files = lock(&self.files);
                        self.not_busy(&root, p)?;
                        core::trash(&root, p, l.map_or("", String::as_str))?;
                        removed += 1;
                        Ok(None)
                    }
                    Op::DeleteRemote => {
                        call(json!({"op": "del", "folder": folder_id, "path": p, "expect": r}), &[])?;
                        removed += 1;
                        Ok(None)
                    }
                    Op::Conflict => {
                        // Bizdeki hal önce kopya olarak iki tarafa yazılır, sonra
                        // not karşıdaki hale geçer: hiçbir adımda içerik tek kopya kalmaz.
                        let (lh, rh) = (l.cloned().unwrap_or_default(), r.cloned().unwrap_or_default());
                        let mine = core::read(&root, p, &lh)?;
                        let (_, theirs) = call(json!({"op": "get", "folder": folder_id, "path": p, "hash": rh}), &[])?;
                        if core::hash(&theirs) != rh {
                            return Err(CallError::Refused("Bozuk veri.".into()));
                        }
                        let copy = core::conflict_name(p, "telefon", &lh);
                        if local.files.get(&copy) != Some(&lh) {
                            self.local_write(&root, &copy, None, &mine)?;
                        }
                        self.local_write(&root, p, Some(&lh), &theirs)?;
                        conflicts += 1;
                        Ok(Some(rh))
                    }
                }
            };
            match step() {
                Ok(Some(h)) => {
                    base.insert(p.clone(), h);
                }
                Ok(None) => {
                    base.remove(p);
                }
                Err(CallError::Lost) => {
                    lost = Some(CallError::Lost.message());
                    break;
                }
                Err(CallError::Refused(e)) => failed.push(format!("{p}: {e}")),
            }
        }
        // Çakışma kopyaları hemen karşıya da gitsin.
        if lost.is_none() && conflicts > 0 {
            let after = self.manifest(&root)?;
            for (p, h) in after.files.iter().filter(|(p, _)| !local.files.contains_key(*p) && !remote.files.contains_key(*p)) {
                let sent = core::read(&root, p, h)
                    .map_err(CallError::from)
                    .and_then(|b| call(json!({"op": "put", "folder": folder_id, "path": p, "expect": null}), &b));
                if sent.is_ok() {
                    base.insert(p.clone(), h.clone());
                }
            }
        }
        if lost.is_none() {
            let _ = call(json!({"op": "done"}), &[]);
        }

        // Yarıda kalsa da yapılanlar kaydedilir; kalanı sonraki eşitleme bitirir.
        {
            let mut g = lock(&self.store);
            if let Some(cur) = g.data.link.as_mut().filter(|c| c.key == link.key && c.folder == link.folder) {
                cur.base = base;
                cur.folder_id = folder_id;
                cur.addrs.retain(|a| *a != addr);
                cur.addrs.insert(0, addr.clone());
                let port = addr.parse::<SocketAddr>().map_or(PORT, |a| a.port());
                add_addrs(&mut cur.addrs, &hello, port);
                if !text(&hello, "name").is_empty() {
                    cur.name = clean_name(text(&hello, "name"));
                }
                if lost.is_none() {
                    cur.last = now();
                }
                g.save().map_err(|e| e.to_string())?;
            }
        }
        if down + removed + conflicts > 0 {
            (self.notify)("files");
        }
        if let Some(e) = lost {
            return Err(e);
        }
        Ok(json!({
            "success": true, "down": down, "up": up, "removed": removed, "conflicts": conflicts,
            "deferred": plan.deferred, "failed": failed, "last": now(),
        }))
    }

    fn not_busy(&self, root: &Path, rel: &str) -> Result<(), CallError> {
        if self.busy_in(root).as_deref() == Some(rel) {
            return Err(CallError::Refused("Not şu an düzenleniyor.".into()));
        }
        Ok(())
    }

    fn local_write(&self, root: &Path, rel: &str, expect: Option<&str>, bytes: &[u8]) -> Result<(), CallError> {
        let _files = lock(&self.files);
        self.not_busy(root, rel)?;
        Ok(core::write(root, rel, expect, bytes)?)
    }
}

fn add_addrs(addrs: &mut Vec<String>, v: &Value, port: u16) {
    for a in v["addrs"].as_array().into_iter().flatten().filter_map(Value::as_str) {
        let Ok(ip) = a.parse::<Ipv4Addr>() else { continue };
        let full = SocketAddr::from((ip, port)).to_string();
        if !addrs.contains(&full) {
            addrs.push(full);
        }
    }
    addrs.truncate(6);
}

enum CallError {
    /// Bağlantı koptu: kalan işler bırakılır.
    Lost,
    /// Yalnız bu dosya yapılamadı.
    Refused(String),
}

impl CallError {
    fn message(self) -> String {
        match self {
            CallError::Lost => "Bağlantı koptu; kalan dosyalar sonraki eşitlemede tamamlanacak.".into(),
            CallError::Refused(e) if e.is_empty() => "Bilgisayar isteği reddetti.".into(),
            CallError::Refused(e) => e,
        }
    }
}

impl From<io::Error> for CallError {
    fn from(e: io::Error) -> Self {
        CallError::Refused(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    struct Fx {
        t: TempDir,
        host: Arc<SyncState>,
        phone: Arc<SyncState>,
        addr: String,
    }

    impl Fx {
        fn new() -> Fx {
            let t = TempDir::new().unwrap();
            std::fs::create_dir_all(t.path().join("pc")).unwrap();
            std::fs::create_dir_all(t.path().join("tel")).unwrap();
            let host = SyncState::new(t.path().join("h.json"), 0, |_| {});
            let phone = SyncState::new(t.path().join("p.json"), 0, |_| {});
            let dir = t.path().join("pc").to_string_lossy().into_owned();
            let st = host.set_host(true, Some(dir)).unwrap();
            let addr = format!("127.0.0.1:{}", st["port"]);
            Fx { t, host, phone, addr }
        }
        fn code(&self) -> String {
            self.host.pair_start().unwrap()["host"]["pairing"]["code"].as_str().unwrap().to_string()
        }
        fn pair(&self, code: &str) -> Result<Value, PairError> {
            self.phone.pair(&self.addr, code, "Pixel", &self.t.path().join("tel").to_string_lossy())
        }
        fn paired() -> Fx {
            let f = Fx::new();
            f.pair(&f.code()).unwrap();
            f
        }
        fn put(&self, rel: &str, text: &str) {
            let p = self.t.path().join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, text).unwrap();
        }
        fn get(&self, rel: &str) -> Option<String> {
            std::fs::read_to_string(self.t.path().join(rel)).ok()
        }
        fn sync(&self) -> Value {
            self.phone.sync_now(false).unwrap()
        }
    }

    impl Drop for Fx {
        fn drop(&mut self) {
            self.host.stop();
        }
    }

    #[test]
    fn notes_travel_both_ways() {
        let f = Fx::paired();
        f.put("pc/a.md", "bilgisayar");
        f.put("tel/alt/b.md", "telefon");
        f.put("pc/buyuk.png", &"x".repeat(300_000));
        let r = f.sync();
        assert_eq!((r["down"].as_u64(), r["up"].as_u64()), (Some(2), Some(1)), "{r}");
        assert_eq!(f.get("tel/a.md").unwrap(), "bilgisayar");
        assert_eq!(f.get("pc/alt/b.md").unwrap(), "telefon");
        assert_eq!(f.get("tel/buyuk.png").unwrap().len(), 300_000);

        f.put("tel/a.md", "telefonda değişti");
        std::fs::remove_file(f.t.path().join("pc/alt/b.md")).unwrap();
        let r = f.sync();
        assert_eq!(f.get("pc/a.md").unwrap(), "telefonda değişti");
        assert_eq!(f.get("tel/alt/b.md"), None);
        assert_eq!(f.get("tel/alt/.trash/b.md").unwrap(), "telefon");
        assert_eq!(r["failed"], json!([]));
        assert_eq!(f.sync()["up"], 0);
        assert!(f.host.status()["host"]["peers"][0]["last"].as_u64().unwrap() > 0);
    }

    #[test]
    fn conflict_keeps_both_versions_on_both_sides() {
        let f = Fx::paired();
        f.put("pc/a.md", "ilk");
        f.sync();
        f.put("pc/a.md", "pc hali");
        f.put("tel/a.md", "telefon hali");
        assert_eq!(f.sync()["conflicts"], 1);
        for side in ["pc", "tel"] {
            assert_eq!(f.get(&format!("{side}/a.md")).unwrap(), "pc hali");
            let copy = core::conflict_name("a.md", "telefon", &core::hash("telefon hali".as_bytes()));
            assert_eq!(f.get(&format!("{side}/{copy}")).unwrap(), "telefon hali");
        }
        let r = f.sync();
        assert_eq!((r["up"].as_u64(), r["down"].as_u64(), r["conflicts"].as_u64()), (Some(0), Some(0), Some(0)));
    }

    #[test]
    fn note_open_in_editor_is_left_alone() {
        let f = Fx::paired();
        f.put("pc/a.md", "ilk");
        f.sync();
        f.put("tel/a.md", "yeni");
        f.host.set_busy(Some(f.t.path().join("pc/a.md").to_string_lossy().into_owned()));
        assert_eq!(f.sync()["deferred"], 1);
        assert_eq!(f.get("pc/a.md").unwrap(), "ilk");
        f.host.set_busy(None);
        f.sync();
        assert_eq!(f.get("pc/a.md").unwrap(), "yeni");
    }

    #[test]
    fn emptied_folder_asks_before_deleting() {
        let f = Fx::paired();
        for i in 0..3 {
            f.put(&format!("pc/{i}.md"), "x");
        }
        f.sync();
        for i in 0..3 {
            std::fs::remove_file(f.t.path().join(format!("tel/{i}.md"))).unwrap();
        }
        let r = f.sync();
        assert_eq!((r["confirm"].as_bool(), r["deletes"].as_u64()), (Some(true), Some(3)));
        assert!(f.get("pc/0.md").is_some());
        f.phone.sync_now(true).unwrap();
        assert!(f.get("pc/0.md").is_none() && f.get("pc/.trash/0.md").is_some());
    }

    #[test]
    fn changing_host_folder_merges_instead_of_deleting() {
        let f = Fx::paired();
        f.put("pc/a.md", "x");
        f.sync();
        f.put("pc2/b.md", "y");
        f.host.set_host(true, Some(f.t.path().join("pc2").to_string_lossy().into_owned())).unwrap();
        f.sync();
        assert!(f.get("tel/a.md").is_some() && f.get("tel/b.md").is_some() && f.get("pc2/a.md").is_some());
    }

    #[test]
    fn wrong_code_is_refused_and_code_expires_after_tries() {
        let f = Fx::new();
        let at = |r: Result<Value, PairError>| r.unwrap_err().at;
        assert_eq!(at(f.pair("12345678")), "closed", "eşleştirme kapalıyken");
        assert_eq!(at(f.pair("123")), "code");
        let code = f.code();
        let wrong = if code == "00000000" { "00000001" } else { "00000000" };
        for _ in 0..CODE_TRIES {
            assert_eq!(at(f.pair(wrong)), "code");
        }
        assert_eq!(at(f.pair(&code)), "closed", "deneme hakkı bitti");
        let code = f.code();
        f.pair(&code).unwrap();
        assert_eq!(at(f.pair(&code)), "closed", "kod tek kullanımlık");
    }

    #[test]
    fn address_check_tells_what_is_wrong_and_costs_no_try() {
        let f = Fx::new();
        f.code();
        assert_eq!(f.phone.check(&f.addr).unwrap()["success"], true);
        assert_eq!(f.host.status()["host"]["pairing"]["tries"], CODE_TRIES);
        assert_eq!(f.phone.check("8.8.8.8").unwrap_err().at, "addr");
        assert_eq!(f.phone.check("192.168.1").unwrap_err().at, "addr");
        let free = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap();
        assert!(["off", "timeout"].contains(&f.phone.check(&free.to_string()).unwrap_err().at));
    }

    #[test]
    fn host_hears_about_attempts() {
        let t = TempDir::new().unwrap();
        let heard = Arc::new(Mutex::new(Vec::<String>::new()));
        let log = heard.clone();
        let host = SyncState::new(t.path().join("h.json"), 0, move |k| lock(&log).push(k.into()));
        let phone = SyncState::new(t.path().join("p.json"), 0, |_| {});
        let dir = t.path().to_string_lossy().into_owned();
        let addr = format!("127.0.0.1:{}", host.set_host(true, Some(dir.clone())).unwrap()["port"]);
        let code = host.pair_start().unwrap()["host"]["pairing"]["code"].as_str().unwrap().to_string();
        let wrong = if code == "00000000" { "00000001" } else { "00000000" };
        for _ in 0..CODE_TRIES {
            assert!(phone.pair(&addr, wrong, "Pixel", &dir).is_err());
        }
        for _ in 0..50 {
            if lock(&heard).iter().any(|k| k == "pair-over") {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let got = lock(&heard).clone();
        assert!(got.contains(&"pair-try".into()) && got.contains(&"pair-bad".into()) && got.contains(&"pair-over".into()), "{got:?}");
        assert!(host.status()["host"]["pairing"].is_null());
        host.stop();
    }

    #[test]
    fn unpaired_or_removed_device_gets_nothing() {
        let f = Fx::paired();
        let id = f.host.status()["host"]["peers"][0]["id"].as_str().unwrap().to_string();
        f.host.remove_peer(&id).unwrap();
        assert!(f.phone.sync_now(false).is_err());
        let g = Fx::paired();
        g.phone.unlink().unwrap();
        assert_eq!(g.host.status()["host"]["peers"], json!([]));
    }

    #[test]
    fn stolen_id_without_key_is_refused() {
        let f = Fx::paired();
        let id = f.host.status()["host"]["peers"][0]["id"].as_str().unwrap().to_string();
        let mut s = connect(parse_addr(&f.addr).unwrap()).unwrap();
        write_frame(&mut s, id.as_bytes()).unwrap();
        assert!(Channel::connect(s, &[7u8; 32]).is_err());
    }

    #[test]
    fn status_never_exposes_keys() {
        let f = Fx::paired();
        let key = lock(&f.host.store).data.host.peers[0].key.clone();
        assert_eq!(key.len(), 64);
        assert!(!f.host.status().to_string().contains(&key) && !f.phone.status().to_string().contains(&key));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(f.t.path().join("h.json")).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[test]
    fn only_private_addresses() {
        for a in ["8.8.8.8", "100.128.0.1", "172.32.0.1", "x", ""] {
            assert!(parse_addr(a).is_err(), "{a}");
        }
        for a in ["192.168.1.5", "10.0.0.2:9000", "100.117.1.1"] {
            assert!(parse_addr(a).is_ok(), "{a}");
        }
    }

    #[test]
    fn too_broad_folders_are_refused() {
        assert!(check_folder("/").is_err());
        assert!(check_folder("").is_err());
        assert!(check_folder("göreli").is_err());
    }
}
