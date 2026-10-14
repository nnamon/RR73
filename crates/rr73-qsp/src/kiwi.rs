//! A KiwiSDR client, written from the protocol as QSP observed it on 15 October 2026 against the
//! SARTS Web-888 (KiwiSDR v2026.205). No KiwiSDR client code was read: the kiwiclient package
//! carries no licence for its core files.
//!
//! - WebSocket at `ws://host:port/<seconds since 1970>/SND`; the client starts with
//!   `SET auth t=kiwi p=` (empty password on a public receiver).
//! - The receiver sends binary messages that start with a 3-letter tag. `MSG` carries
//!   space-separated `name=value` parameters: `audio_rate` and `sample_rate` (12000 on both
//!   Singapore receivers), `badp` (1 when the password is refused), `too_busy`, version and
//!   configuration. `SND` carries audio: a flags byte, a sequence number (u32, little-endian), an
//!   S-meter value (u16, big-endian), then 16-bit big-endian samples (512 per message at 12 kHz)
//!   while compression is off.
//! - Once the rate is known the client sets the audio rate, squelch, generator, listener name,
//!   USB mode with its passband and dial (kHz), AGC and compression, and sends `SET keepalive`
//!   every 5 s.
//!
//! Checked by decoding a captured slot with jt9: 19 FT8 stations at DT about +0.3 s.

use futures_util::{SinkExt, StreamExt};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

/// The only audio rate QSP takes from a receiver, Hz.
pub const RATE_HZ: u32 = 12_000;
/// Passband for FT8, FT4, WSPR and RTTY at the dial, Hz.
pub const PASSBAND_HZ: (u32, u32) = (100, 3000);
/// Time allowed to connect or to read the status page.
const TIMEOUT: Duration = Duration::from_secs(10);
const KEEPALIVE: Duration = Duration::from_secs(5);
/// Frames over which the first timestamp is settled: about 1 s.
const SETTLE_FRAMES: usize = 24;
/// Time off by more than this, one way for a frame or the other way for every frame of a window,
/// is a gap, µs.
const GAP_US: i64 = 500_000;
/// Frames in the window that checks for lost samples: about 5 s.
const WINDOW_FRAMES: usize = 120;

/// A message from the receiver.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Upstream {
    /// `MSG`: name and value pairs, the value absent for a bare name.
    Msg(Vec<(String, Option<String>)>),
    /// `SND`: audio.
    Snd {
        /// The receiver's flags byte.
        flags: u8,
        /// The receiver's sequence number.
        seq: u32,
        /// The receiver's S-meter value.
        smeter: u16,
        /// Samples at the receiver's rate.
        samples: Vec<i16>,
    },
    /// Any other tag.
    Other(String),
}

/// Reads one binary message from the receiver; None when it is shorter than a tag.
pub fn parse(bytes: &[u8]) -> Option<Upstream> {
    if bytes.len() < 3 {
        return None;
    }
    match &bytes[..3] {
        b"MSG" => {
            let text = String::from_utf8_lossy(bytes.get(4..).unwrap_or_default());
            let params = text
                .split(' ')
                .filter(|p| !p.is_empty())
                .map(|p| match p.split_once('=') {
                    Some((k, v)) => (k.to_string(), Some(v.to_string())),
                    None => (p.to_string(), None),
                })
                .collect();
            Some(Upstream::Msg(params))
        }
        b"SND" => {
            if bytes.len() < 10 {
                return None;
            }
            let seq = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
            let smeter = u16::from_be_bytes([bytes[8], bytes[9]]);
            let samples = bytes[10..]
                .as_chunks::<2>()
                .0
                .iter()
                .map(|c| i16::from_be_bytes(*c))
                .collect();
            Some(Upstream::Snd {
                flags: bytes[3],
                seq,
                smeter,
                samples,
            })
        }
        tag => Some(Upstream::Other(String::from_utf8_lossy(tag).into_owned())),
    }
}

/// The WebSocket address for one listening session.
pub fn url(host: &str, port: u16, now_s: u64) -> String {
    format!("ws://{host}:{port}/{now_s}/SND")
}

/// The command that tunes USB to `dial_hz`.
pub fn tune_command(dial_hz: u64) -> String {
    format!(
        "SET mod=usb low_cut={} high_cut={} freq={:.3}",
        PASSBAND_HZ.0,
        PASSBAND_HZ.1,
        dial_hz as f64 / 1000.0
    )
}

/// The commands sent once the receiver has given its rate. `listener` is the name its other
/// listeners see.
pub fn setup_commands(listener: &str, dial_hz: u64) -> Vec<String> {
    vec![
        format!("SET AR OK in={RATE_HZ} out=44100"),
        "SET squelch=0 max=0".into(),
        "SET genattn=0".into(),
        "SET gen=0 mix=-1".into(),
        format!("SET ident_user={}", percent_encode(listener)),
        tune_command(dial_hz),
        "SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50".into(),
        "SET compression=0".into(),
    ]
}

fn percent_encode(s: &str) -> String {
    s.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.~/".contains(&b) {
                char::from(b).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

/// Channel use from the receiver's `/status` page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Status {
    /// Listeners now.
    pub users: u32,
    /// Channels in all.
    pub users_max: u32,
}

impl Status {
    /// True when taking a channel would leave fewer than `free` for other listeners.
    pub fn too_full(&self, free: u32) -> bool {
        self.users + 1 + free > self.users_max
    }
}

/// Reads `users` and `users_max` from a `/status` page.
pub fn parse_status(text: &str) -> Option<Status> {
    let mut users = None;
    let mut max = None;
    for line in text.lines() {
        match line.split_once('=') {
            Some(("users", v)) => users = v.trim().parse().ok(),
            Some(("users_max", v)) => max = v.trim().parse().ok(),
            _ => {}
        }
    }
    Some(Status {
        users: users?,
        users_max: max?,
    })
}

/// Reads the receiver's `/status` page over plain HTTP.
pub async fn fetch_status(host: &str, port: u16) -> Result<Status, String> {
    let work = async {
        let mut s = tokio::net::TcpStream::connect((host, port))
            .await
            .map_err(|e| e.to_string())?;
        let req = format!(
            "GET /status HTTP/1.0\r\nHost: {host}\r\nUser-Agent: RR73-QSP/{}\r\n\r\n",
            env!("CARGO_PKG_VERSION")
        );
        s.write_all(req.as_bytes()).await.map_err(|e| e.to_string())?;
        let mut buf = Vec::new();
        s.take(64 * 1024)
            .read_to_end(&mut buf)
            .await
            .map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&buf);
        let body = text.split_once("\r\n\r\n").map_or(text.as_ref(), |(_, b)| b);
        parse_status(body).ok_or_else(|| "the status page has no users count".to_string())
    };
    tokio::time::timeout(TIMEOUT, work)
        .await
        .map_err(|_| "the status page did not answer within 10 s".to_string())?
}

/// Where and how to listen.
#[derive(Debug, Clone)]
pub struct Target {
    /// Host name or address.
    pub host: String,
    /// Port.
    pub port: u16,
    /// Dial frequency, Hz.
    pub dial_hz: u64,
    /// Name the receiver's other listeners see.
    pub listener: String,
    /// How late the receiver's audio arrives, s.
    pub latency_s: f64,
    /// Channels to leave free for others.
    pub free_channels: u32,
}

/// What a session tells its stream.
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    /// Tuned and receiving.
    Streaming,
    /// Audio at 12 kHz from `utc_us` (µs since 1970); `gap` when it does not follow on.
    Audio {
        /// UTC of the first sample, µs since 1970.
        utc_us: i64,
        /// Samples at 12 kHz.
        samples: Vec<i16>,
        /// Audio is missing before these samples.
        gap: bool,
    },
    /// A message from the receiver about time limits or being moved off.
    Notice(String),
    /// The session is over.
    Ended(End),
}

/// Why a session ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum End {
    /// Too few free channels, by the status page or the receiver's own word.
    Busy,
    /// The receiver turned QSP away.
    Refused(String),
    /// The receiver closed the connection; with its last notice when it gave one.
    Closed(Option<String>),
    /// Network or protocol failure.
    Error(String),
    /// The app or QSP stopped it.
    Stopped,
}

impl End {
    /// A short code for the app: busy, refused, closed, error, stopped.
    pub fn code(&self) -> &'static str {
        match self {
            End::Busy => "busy",
            End::Refused(_) => "refused",
            End::Closed(_) => "closed",
            End::Error(_) => "error",
            End::Stopped => "stopped",
        }
    }

    /// What happened, in words.
    pub fn message(&self) -> String {
        match self {
            End::Busy => "The receiver has no channel to spare.".into(),
            End::Refused(why) => format!("The receiver refused the connection: {why}."),
            End::Closed(Some(n)) => format!("The receiver closed the connection after: {n}."),
            End::Closed(None) => "The receiver closed the connection.".into(),
            End::Error(why) => format!("The connection failed: {why}."),
            End::Stopped => "Stopped.".into(),
        }
    }
}

/// What a stream tells its session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Control {
    /// Retune to a dial frequency, Hz.
    Tune(u64),
    /// End the session.
    Stop,
}

/// Turns arrival times into sample times. The first second's earliest frame sets the start and
/// the sample count carries it on. Late arrivals alone change nothing: the network delays frames
/// without losing samples. A gap is flagged where the receiver's sequence numbers skip, and where
/// every frame for 5 s arrives more than 0.5 s behind its time, which means samples went missing.
#[derive(Debug, Default)]
pub struct Clock {
    anchor_us: Option<i64>,
    settling: Vec<(i64, Vec<i16>)>,
    count: u64,
    latency_us: i64,
    last_seq: Option<u32>,
    window_min_us: i64,
    window_frames: usize,
}

impl Clock {
    /// A clock for a receiver whose audio arrives `latency_s` late.
    pub fn new(latency_s: f64) -> Self {
        Clock {
            latency_us: (latency_s * 1e6) as i64,
            window_min_us: i64::MAX,
            ..Clock::default()
        }
    }

    fn duration_us(samples: u64) -> i64 {
        (samples as i64 * 1_000_000) / i64::from(RATE_HZ)
    }

    fn start_of(&self, arrived_us: i64, n: usize) -> i64 {
        arrived_us - Self::duration_us(n as u64) - self.latency_us
    }

    fn at(&self, anchor: i64) -> i64 {
        anchor + Self::duration_us(self.count)
    }

    /// Takes a frame with the receiver's sequence number `seq` that arrived at `arrived_us`;
    /// returns the frames ready to send, each with its UTC and whether a gap comes before it.
    pub fn push(&mut self, arrived_us: i64, seq: u32, samples: Vec<i16>) -> Vec<(i64, Vec<i16>, bool)> {
        let start = self.start_of(arrived_us, samples.len());
        let skipped = match self.last_seq.replace(seq) {
            Some(last) => {
                let jump = seq.wrapping_sub(last);
                if jump > 1 && jump < 10_000 {
                    u64::from(jump - 1) * samples.len() as u64
                } else {
                    0
                }
            }
            None => 0,
        };
        let Some(mut anchor) = self.anchor_us else {
            self.settling.push((start, samples));
            if self.settling.len() < SETTLE_FRAMES {
                return Vec::new();
            }
            // Each frame's own estimate, less the samples before it; the earliest arrived least late.
            let mut before = 0u64;
            let mut best = i64::MAX;
            for (s, f) in &self.settling {
                best = best.min(s - Self::duration_us(before));
                before += f.len() as u64;
            }
            self.anchor_us = Some(best);
            let frames = std::mem::take(&mut self.settling);
            return frames
                .into_iter()
                .map(|(_, f)| self.emit(best, f, false))
                .collect();
        };
        let mut gap = skipped > 0;
        self.count += skipped;
        let late = start - self.at(anchor);
        if late < -GAP_US {
            // Earlier than its time can be: the start was set too late.
            anchor += late;
            gap = true;
        }
        self.window_min_us = self.window_min_us.min(late);
        self.window_frames += 1;
        if self.window_frames >= WINDOW_FRAMES {
            if self.window_min_us > GAP_US {
                anchor += self.window_min_us;
                gap = true;
            }
            self.window_min_us = i64::MAX;
            self.window_frames = 0;
        }
        self.anchor_us = Some(anchor);
        vec![self.emit(anchor, samples, gap)]
    }

    fn emit(&mut self, anchor: i64, samples: Vec<i16>, gap: bool) -> (i64, Vec<i16>, bool) {
        let t = self.at(anchor);
        self.count += samples.len() as u64;
        (t, samples, gap)
    }
}

fn now_us() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_micros() as i64)
}

/// MSG parameters about time limits or being moved off; the configuration messages carry the
/// limit settings themselves and are left out.
fn is_notice(name: &str, value: Option<&str>) -> bool {
    if matches!(name, "load_cfg" | "load_dxcfg" | "load_dxcomm_cfg" | "cfg_loaded") {
        return false;
    }
    let text = format!("{name} {}", value.unwrap_or_default()).to_ascii_lowercase();
    ["limit", "timeout", "inactiv", "kick"]
        .iter()
        .any(|w| text.contains(w))
}

/// Listens until the receiver ends the session, the app stops it or the events go unread.
pub async fn run(target: Target, events: mpsc::Sender<Event>, mut control: mpsc::Receiver<Control>) {
    let end = listen(&target, &events, &mut control).await;
    let _ = events.send(Event::Ended(end)).await;
}

async fn listen(target: &Target, events: &mpsc::Sender<Event>, control: &mut mpsc::Receiver<Control>) -> End {
    match fetch_status(&target.host, target.port).await {
        Ok(s) if s.too_full(target.free_channels) => return End::Busy,
        Ok(_) => {}
        Err(e) => return End::Error(e),
    }
    let now_s = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let connect = tokio_tungstenite::connect_async(url(&target.host, target.port, now_s));
    let mut ws = match tokio::time::timeout(TIMEOUT, connect).await {
        Ok(Ok((ws, _))) => ws,
        Ok(Err(e)) => return End::Error(e.to_string()),
        Err(_) => return End::Error("no answer within 10 s".into()),
    };
    if ws.send(Message::Text("SET auth t=kiwi p=".into())).await.is_err() {
        return End::Error("the receiver closed the connection at once".into());
    }
    let mut dial = target.dial_hz;
    let mut tuned = false;
    let mut clock = Clock::new(target.latency_s);
    let mut last_notice: Option<String> = None;
    let mut keepalive = tokio::time::interval(KEEPALIVE);
    keepalive.tick().await;
    loop {
        tokio::select! {
            msg = ws.next() => {
                let bytes = match msg {
                    Some(Ok(Message::Binary(b))) => b,
                    Some(Ok(Message::Close(_))) | None => return End::Closed(last_notice),
                    Some(Ok(_)) => continue,
                    Some(Err(e)) => return End::Error(e.to_string()),
                };
                match parse(&bytes) {
                    Some(Upstream::Msg(params)) => {
                        for (name, value) in params {
                            let v = value.as_deref();
                            match name.as_str() {
                                "badp" if v != Some("0") => return End::Refused("it wants a password".into()),
                                "too_busy" => return End::Busy,
                                "down" => return End::Refused("it is down".into()),
                                "redirect" => return End::Refused("it redirects listeners elsewhere".into()),
                                "audio_rate" | "sample_rate" if !tuned => {
                                    let rate = v.and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
                                    if (rate - f64::from(RATE_HZ)).abs() > 0.5 {
                                        return End::Refused(format!("its audio rate is {rate} Hz, and QSP takes {RATE_HZ} Hz"));
                                    }
                                    tuned = true;
                                    for c in setup_commands(&target.listener, dial) {
                                        if ws.send(Message::Text(c.into())).await.is_err() {
                                            return End::Closed(last_notice);
                                        }
                                    }
                                    if events.send(Event::Streaming).await.is_err() {
                                        return End::Stopped;
                                    }
                                }
                                _ if is_notice(&name, v) => {
                                    let text = match v { Some(v) => format!("{name}={}", v.chars().take(100).collect::<String>()), None => name.clone() };
                                    last_notice = Some(text.clone());
                                    if events.send(Event::Notice(text)).await.is_err() {
                                        return End::Stopped;
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                    Some(Upstream::Snd { seq, samples, .. }) if tuned => {
                        for (utc_us, samples, gap) in clock.push(now_us(), seq, samples) {
                            if events.send(Event::Audio { utc_us, samples, gap }).await.is_err() {
                                let _ = ws.close(None).await;
                                return End::Stopped;
                            }
                        }
                    }
                    _ => {}
                }
            }
            c = control.recv() => match c {
                Some(Control::Tune(hz)) => {
                    dial = hz;
                    if tuned && ws.send(Message::Text(tune_command(dial).into())).await.is_err() {
                        return End::Closed(last_notice);
                    }
                }
                Some(Control::Stop) | None => {
                    let _ = ws.close(None).await;
                    return End::Stopped;
                }
            },
            _ = keepalive.tick() => {
                if ws.send(Message::Text("SET keepalive".into())).await.is_err() {
                    return End::Closed(last_notice);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_msg_parameters_as_the_receiver_sends_them() {
        let m = parse(b"MSG audio_rate=12000 sample_rate=12000.000000 cfg_loaded badp=0").expect("parses");
        assert_eq!(
            m,
            Upstream::Msg(vec![
                ("audio_rate".into(), Some("12000".into())),
                ("sample_rate".into(), Some("12000.000000".into())),
                ("cfg_loaded".into(), None),
                ("badp".into(), Some("0".into())),
            ])
        );
    }

    #[test]
    fn reads_snd_frames_big_endian_with_a_little_endian_sequence() {
        let mut b = b"SND".to_vec();
        b.push(5);
        b.extend_from_slice(&7u32.to_le_bytes());
        b.extend_from_slice(&408u16.to_be_bytes());
        b.extend_from_slice(&1000i16.to_be_bytes());
        b.extend_from_slice(&(-2i16).to_be_bytes());
        assert_eq!(
            parse(&b),
            Some(Upstream::Snd {
                flags: 5,
                seq: 7,
                smeter: 408,
                samples: vec![1000, -2]
            })
        );
        assert_eq!(parse(b"W/F\x01"), Some(Upstream::Other("W/F".into())));
        assert_eq!(parse(b"SN"), None);
        assert_eq!(parse(b"SND\x00\x01"), None);
    }

    #[test]
    fn sends_the_setup_and_tunes_in_khz() {
        let c = setup_commands("9V1NE via RR73", 14_074_000);
        assert_eq!(c[0], "SET AR OK in=12000 out=44100");
        assert!(c.contains(&"SET ident_user=9V1NE%20via%20RR73".to_string()));
        assert!(c.contains(&"SET mod=usb low_cut=100 high_cut=3000 freq=14074.000".to_string()));
        assert_eq!(
            tune_command(7_074_000),
            "SET mod=usb low_cut=100 high_cut=3000 freq=7074.000"
        );
        assert_eq!(
            url("167.172.88.10", 80, 1_791_994_254),
            "ws://167.172.88.10:80/1791994254/SND"
        );
    }

    #[test]
    fn keeps_channels_free_by_the_status_page() {
        let s = parse_status("status=private\nusers=10\nusers_max=13\n").expect("parses");
        assert_eq!(
            s,
            Status {
                users: 10,
                users_max: 13
            }
        );
        assert!(!s.too_full(2));
        assert!(s.too_full(3));
        assert!(
            Status {
                users: 4,
                users_max: 4
            }
            .too_full(0)
        );
        assert!(parse_status("users=3\n").is_none());
    }

    #[test]
    fn times_frames_from_the_earliest_arrival_and_flags_only_real_gaps() {
        let mut c = Clock::new(0.0);
        let frame = || vec![0i16; 512];
        let dur = 512 * 1_000_000 / 12_000; // 42 666 µs
        let at = |i: i64| 1_000_000 + (i + 1) * dur;
        let mut out = Vec::new();
        // The first frame arrives 30 ms late, the rest on time.
        for i in 0..SETTLE_FRAMES as i64 {
            let late = if i == 0 { 30_000 } else { 0 };
            out.extend(c.push(at(i) + late, i as u32, frame()));
        }
        assert_eq!(out.len(), SETTLE_FRAMES);
        assert!((out[0].0 - 1_000_000).abs() < 100, "first frame at {}", out[0].0);
        assert!((out[5].0 - (1_000_000 + 5 * dur)).abs() < 100);
        let mut i = SETTLE_FRAMES as i64;
        // A burst 1.5 s late: the network held frames back, nothing is lost and nothing is flagged.
        for _ in 0..10 {
            let f = c.push(at(i) + 1_500_000, i as u32, frame());
            assert!(!f[0].2);
            assert!((f[0].0 - (1_000_000 + i * dur)).abs() < 200);
            i += 1;
        }
        // The receiver skips 3 frames: flagged, and the time moves on past them.
        let f = c.push(at(i + 3), (i + 3) as u32, frame());
        assert!(f[0].2);
        assert!((f[0].0 - (1_000_000 + (i + 3) * dur)).abs() < 200);
        i += 4;
        // Samples lost without a skip: once a whole window runs 2 s behind, the time moves, once.
        let mut flagged = 0;
        for _ in 0..2 * WINDOW_FRAMES {
            if c.push(at(i) + 2_000_000, i as u32, frame())[0].2 {
                flagged += 1;
            }
            i += 1;
        }
        assert_eq!(flagged, 1);
        let f = c.push(at(i) + 2_000_000, i as u32, frame());
        assert!(!f[0].2);
        assert!((f[0].0 - (1_000_000 + i * dur + 2_000_000)).abs() < 200);
    }

    #[test]
    fn reports_limit_and_kick_messages_and_not_the_configuration() {
        assert!(is_notice("inactivity_timeout", Some("1")));
        assert!(is_notice("kicked", None));
        assert!(!is_notice("load_cfg", Some("time_limit")));
        assert!(!is_notice("audio_rate", Some("12000")));
    }
}
