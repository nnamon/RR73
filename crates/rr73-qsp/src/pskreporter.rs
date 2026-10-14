//! Reports to PSK Reporter (docs/design/qsp.md, PSK Reporter), by the rules of its developer page
//! (https://pskreporter.info/pskdev.html, read 15 October 2026).
//!
//! Each receiving station is its own report stream: its own observation domain, sequence number
//! and timer. A stream sends at most one datagram every `interval_s` (300 s), unless one fills
//! up, on a timer that starts at a random point. Each callsign goes at most once per 5 min, and
//! once an hour while its band and mode stay the same. The record formats go in a stream's first
//! 3 datagrams and then once an hour. Datagrams stay under 1400 bytes. All datagrams leave from
//! one UDP socket, so from one source port.

use rand::Rng;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::net::UdpSocket;

/// PSK Reporter's IANA enterprise number.
const ENTERPRISE: u32 = 30351;
/// Variable-length field.
const VAR: u16 = 0xFFFF;
/// Largest datagram sent, bytes.
pub const MAX_DATAGRAM: usize = 1400;
/// Shortest time between two reports of one callsign, s.
const REPEAT_MIN_S: u64 = 300;
/// Time after which a callsign is reported again with nothing changed, s.
const REPEAT_SAME_S: u64 = 3600;
/// Datagrams that carry the record formats when a stream starts.
const FIRST_WITH_FORMATS: u32 = 3;
/// Time after which the record formats go again, s.
const FORMATS_EVERY_S: u64 = 3600;
/// A stream with nothing taken for this long is dropped, s.
const STREAM_IDLE_S: u64 = 7200;

/// One field of a record format: an element id and its length, `VAR` for strings.
#[derive(Debug, Clone, Copy)]
pub struct Field {
    /// Element id: an enterprise element of 30351, or an IANA one.
    pub id: u16,
    /// Length in bytes, or `VAR`.
    pub len: u16,
    /// True for PSK Reporter's own elements.
    pub enterprise: bool,
}

const fn psk(id: u16, len: u16) -> Field {
    Field {
        id,
        len,
        enterprise: true,
    }
}

/// A record format: its template id, fields, and whether it describes the receiver (an options
/// template with one scope field) or the senders.
#[derive(Debug, Clone, Copy)]
pub struct Format {
    /// Template id, 256 to 65535; links records to the format.
    pub id: u16,
    /// The fields in order.
    pub fields: &'static [Field],
    /// True for the receiver's options template.
    pub receiver: bool,
}

/// receiverCallsign, receiverLocator, decodingSoftware, antennaInformation.
pub const RECEIVER: Format = Format {
    id: 0x9992,
    fields: &[psk(2, VAR), psk(4, VAR), psk(8, VAR), psk(9, VAR)],
    receiver: true,
};

/// senderCallsign, frequency, sNR, iMD, mode, informationSource, senderLocator,
/// flowStartSeconds: the page's fourth sender format.
pub const SENDER: Format = Format {
    id: 0x9993,
    fields: &[
        psk(1, VAR),
        psk(5, 4),
        psk(6, 1),
        psk(7, 1),
        psk(10, VAR),
        psk(11, 1),
        psk(3, VAR),
        Field {
            id: 150,
            len: 4,
            enterprise: false,
        },
    ],
    receiver: false,
};

/// A value in a record.
#[derive(Debug, Clone, Copy)]
pub enum Value<'a> {
    /// A string: a length byte, then up to 254 bytes.
    Str(&'a str),
    /// An unsigned integer in the field's length.
    Uint(u32),
    /// A signed byte.
    I8(i8),
}

fn put_str(out: &mut Vec<u8>, s: &str) {
    let b = s.as_bytes();
    let n = b.len().min(254);
    out.push(n as u8);
    out.extend_from_slice(&b[..n]);
}

fn pad4(out: &mut Vec<u8>, from: usize) {
    while !(out.len() - from).is_multiple_of(4) {
        out.push(0);
    }
}

/// The template set that describes `f`.
pub fn format_set(f: &Format) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&(if f.receiver { 3u16 } else { 2u16 }).to_be_bytes());
    out.extend_from_slice(&[0, 0]);
    out.extend_from_slice(&f.id.to_be_bytes());
    out.extend_from_slice(&(f.fields.len() as u16).to_be_bytes());
    if f.receiver {
        out.extend_from_slice(&1u16.to_be_bytes());
    }
    for field in f.fields {
        if field.enterprise {
            out.extend_from_slice(&(0x8000 | field.id).to_be_bytes());
            out.extend_from_slice(&field.len.to_be_bytes());
            out.extend_from_slice(&ENTERPRISE.to_be_bytes());
        } else {
            out.extend_from_slice(&field.id.to_be_bytes());
            out.extend_from_slice(&field.len.to_be_bytes());
        }
    }
    pad4(&mut out, 0);
    let len = out.len() as u16;
    out[2..4].copy_from_slice(&len.to_be_bytes());
    out
}

/// One record's bytes, values in the format's order.
pub fn record(f: &Format, values: &[Value<'_>]) -> Vec<u8> {
    let mut out = Vec::new();
    for (field, v) in f.fields.iter().zip(values) {
        match *v {
            Value::Str(s) => put_str(&mut out, s),
            Value::I8(x) => out.push(x as u8),
            Value::Uint(x) => {
                let b = x.to_be_bytes();
                let n = usize::from(field.len).min(4);
                out.extend_from_slice(&b[4 - n..]);
            }
        }
    }
    out
}

/// A data set: the format's id, the length, the records, padding to 4 bytes.
pub fn data_set(f: &Format, records: &[Vec<u8>]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&f.id.to_be_bytes());
    out.extend_from_slice(&[0, 0]);
    for r in records {
        out.extend_from_slice(r);
    }
    pad4(&mut out, 0);
    let len = out.len() as u16;
    out[2..4].copy_from_slice(&len.to_be_bytes());
    out
}

/// A whole datagram: the header, then the parts in order.
pub fn datagram(export_s: u32, sequence: u32, domain: u32, parts: &[Vec<u8>]) -> Vec<u8> {
    let mut out = Vec::with_capacity(MAX_DATAGRAM);
    out.extend_from_slice(&0x000Au16.to_be_bytes());
    out.extend_from_slice(&[0, 0]);
    out.extend_from_slice(&export_s.to_be_bytes());
    out.extend_from_slice(&sequence.to_be_bytes());
    out.extend_from_slice(&domain.to_be_bytes());
    for p in parts {
        out.extend_from_slice(p);
    }
    let len = out.len() as u16;
    out[2..4].copy_from_slice(&len.to_be_bytes());
    out
}

/// The receiving station, as the app sends it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Station {
    /// Callsign, upper case.
    pub callsign: String,
    /// Maidenhead locator, 4 or 6 characters.
    pub locator: String,
    /// Decoding software and version: `RR73 0.16.2`.
    pub software: String,
    /// The antenna, free text; empty when not given.
    pub antenna: String,
}

/// One station heard.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Spot {
    /// The sender's callsign, upper case.
    pub callsign: String,
    /// The sender's locator; empty when not heard.
    pub locator: String,
    /// RF frequency: dial plus audio, Hz.
    pub frequency_hz: u32,
    /// SNR in 2500 Hz, dB.
    pub snr_db: i8,
    /// ADIF mode or submode: FT8, FT4.
    pub mode: String,
    /// When it was heard, s since 1970.
    pub time_s: u32,
}

impl Spot {
    /// What counts as a change for the once-an-hour rule: the mode and the MHz of the frequency.
    fn change_key(&self) -> (String, u32) {
        (self.mode.clone(), self.frequency_hz / 1_000_000)
    }
}

/// What a batch of spots came to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Taken {
    /// Spots queued for the next datagram.
    pub taken: usize,
    /// Spots dropped as reported too recently.
    pub repeats: usize,
    /// Earliest time the next datagram may go, s since 1970.
    pub next_report_s: u64,
}

/// A stream's state, for the status endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StreamStatus {
    /// Spots waiting for the next datagram.
    pub waiting: usize,
    /// Spots sent since the stream started.
    pub sent: u32,
    /// Datagrams sent.
    pub datagrams: u32,
    /// When the last datagram went, s since 1970.
    pub last_sent_s: Option<u64>,
    /// Earliest time the next datagram may go, s since 1970.
    pub next_report_s: u64,
}

struct Stream {
    station: Station,
    domain: u32,
    /// Sender records sent so far: the header's sequence number.
    sequence: u32,
    datagrams: u32,
    formats_sent_s: Option<u64>,
    last_sent_s: Option<u64>,
    next_due_s: u64,
    last_taken_s: u64,
    pending: Vec<Spot>,
    /// Callsign to the change key and time of its last report.
    reported: HashMap<String, ((String, u32), u64)>,
}

/// The settings that shape the datagrams.
#[derive(Debug, Clone, Copy)]
pub struct Rules {
    /// Shortest time between a stream's datagrams, s.
    pub interval_s: u64,
    /// Sets the 0x80 test bit in informationSource.
    pub test: bool,
}

/// Every report stream, keyed by the receiving callsign.
pub struct Reporter {
    rules: Rules,
    streams: HashMap<String, Stream>,
}

impl Reporter {
    /// A reporter with no streams.
    pub fn new(rules: Rules) -> Self {
        Self {
            rules,
            streams: HashMap::new(),
        }
    }

    /// Queues spots heard by `station` at `now_s`. A spot already waiting, or reported too
    /// recently, is a repeat. A change of the station's locator, software or antenna starts its
    /// stream again.
    pub fn take(&mut self, now_s: u64, station: Station, spots: Vec<Spot>) -> Taken {
        let interval = self.rules.interval_s;
        let key = station.callsign.clone();
        if self.streams.get(&key).is_some_and(|s| s.station != station) {
            self.streams.remove(&key);
        }
        let stream = self.streams.entry(key).or_insert_with(|| {
            let mut rng = rand::rng();
            Stream {
                station,
                domain: rng.random(),
                sequence: 0,
                datagrams: 0,
                formats_sent_s: None,
                last_sent_s: None,
                next_due_s: now_s + rng.random_range(interval / 2..=interval),
                last_taken_s: now_s,
                pending: Vec::new(),
                reported: HashMap::new(),
            }
        });
        stream.last_taken_s = now_s;
        let mut taken = 0;
        let mut repeats = 0;
        for spot in spots {
            if let Some(p) = stream.pending.iter_mut().find(|p| p.callsign == spot.callsign) {
                if p.locator.is_empty() && !spot.locator.is_empty() {
                    p.locator = spot.locator;
                }
                repeats += 1;
                continue;
            }
            let fresh = match stream.reported.get(&spot.callsign) {
                None => true,
                Some((change, at)) => {
                    let since = now_s.saturating_sub(*at);
                    since >= REPEAT_SAME_S || (since >= REPEAT_MIN_S && *change != spot.change_key())
                }
            };
            if fresh {
                stream.pending.push(spot);
                taken += 1;
            } else {
                repeats += 1;
            }
        }
        Taken {
            taken,
            repeats,
            next_report_s: next_report(stream, interval),
        }
    }

    /// The datagrams due at `now_s`, and drops idle streams. A stream sends when it has spots
    /// waiting and its timer has run, or at once when its spots fill a datagram.
    pub fn due(&mut self, now_s: u64) -> Vec<Vec<u8>> {
        let rules = self.rules;
        self.streams
            .retain(|_, s| !s.pending.is_empty() || now_s.saturating_sub(s.last_taken_s) < STREAM_IDLE_S);
        let mut out = Vec::new();
        for s in self.streams.values_mut() {
            loop {
                if s.pending.is_empty() {
                    break;
                }
                let on_time = now_s >= next_report(s, rules.interval_s);
                let (bytes, used) = build(s, now_s, rules);
                let full = used < s.pending.len();
                if !on_time && !full {
                    break;
                }
                for spot in s.pending.drain(..used) {
                    s.reported
                        .insert(spot.callsign.clone(), (spot.change_key(), now_s));
                }
                s.sequence = s.sequence.wrapping_add(used as u32);
                if s.datagrams < FIRST_WITH_FORMATS
                    || s.formats_sent_s
                        .is_none_or(|t| now_s.saturating_sub(t) >= FORMATS_EVERY_S)
                {
                    s.formats_sent_s = Some(now_s);
                }
                s.datagrams += 1;
                s.last_sent_s = Some(now_s);
                s.next_due_s = now_s + rules.interval_s + rand::rng().random_range(0..=rules.interval_s / 10);
                out.push(bytes);
                if !full {
                    break;
                }
            }
            s.reported
                .retain(|_, (_, at)| now_s.saturating_sub(*at) < REPEAT_SAME_S);
        }
        out
    }

    /// True when a stream has a datagram due at `now_s`.
    pub fn has_due(&self, now_s: u64) -> bool {
        self.streams.values().any(|s| {
            !s.pending.is_empty()
                && (now_s >= next_report(s, self.rules.interval_s)
                    || build(s, now_s, self.rules).1 < s.pending.len())
        })
    }

    /// A stream's state by its receiving callsign.
    pub fn status(&self, callsign: &str) -> Option<StreamStatus> {
        let s = self.streams.get(callsign)?;
        Some(StreamStatus {
            waiting: s.pending.len(),
            sent: s.sequence,
            datagrams: s.datagrams,
            last_sent_s: s.last_sent_s,
            next_report_s: next_report(s, self.rules.interval_s),
        })
    }
}

/// Sends the datagrams due at `now_s` from `socket` to `target`; returns how many went.
pub async fn send_due(
    reporter: &Mutex<Reporter>,
    socket: &UdpSocket,
    target: SocketAddr,
    now_s: u64,
) -> usize {
    let due = reporter
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .due(now_s);
    let mut sent = 0;
    for d in due {
        match socket.send_to(&d, target).await {
            Ok(_) => sent += 1,
            Err(e) => tracing::warn!("PSK Reporter datagram to {target} failed: {e}"),
        }
    }
    sent
}

/// Sends the reporter's datagrams every 5 s from one UDP socket, so from one source port, to
/// `host:port`, looked up again for each batch.
pub async fn run(reporter: Arc<Mutex<Reporter>>, host: String, port: u16) {
    let socket = match UdpSocket::bind(("0.0.0.0", 0)).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("PSK Reporter: no UDP socket: {e}");
            return;
        }
    };
    let mut tick = tokio::time::interval(Duration::from_secs(5));
    loop {
        tick.tick().await;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_secs());
        let waiting = reporter
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .has_due(now);
        if !waiting {
            continue;
        }
        let target = match tokio::net::lookup_host((host.as_str(), port)).await {
            Ok(mut a) => a.find(SocketAddr::is_ipv4),
            Err(e) => {
                tracing::warn!("PSK Reporter: cannot look up {host}: {e}");
                None
            }
        };
        if let Some(t) = target {
            let n = send_due(&reporter, &socket, t, now).await;
            tracing::info!("PSK Reporter: {n} datagrams to {t}");
        }
    }
}

fn next_report(s: &Stream, interval_s: u64) -> u64 {
    let after_last = s.last_sent_s.map_or(0, |t| t + interval_s);
    s.next_due_s.max(after_last)
}

/// The datagram for a stream's waiting spots at `now_s`, and how many of them fit.
fn build(s: &Stream, now_s: u64, rules: Rules) -> (Vec<u8>, usize) {
    let st = &s.station;
    let formats = s.datagrams < FIRST_WITH_FORMATS
        || s.formats_sent_s
            .is_none_or(|t| now_s.saturating_sub(t) >= FORMATS_EVERY_S);
    let mut parts = Vec::new();
    if formats {
        parts.push(format_set(&RECEIVER));
        parts.push(format_set(&SENDER));
    }
    let receiver = record(
        &RECEIVER,
        &[
            Value::Str(&st.callsign),
            Value::Str(&st.locator),
            Value::Str(&st.software),
            Value::Str(&st.antenna),
        ],
    );
    parts.push(data_set(&RECEIVER, &[receiver]));
    let fixed: usize = 16 + parts.iter().map(Vec::len).sum::<usize>() + 4 + 3;
    let source = 1 | if rules.test { 0x80 } else { 0 };
    let mut records = Vec::new();
    let mut size = fixed;
    for spot in &s.pending {
        let r = record(
            &SENDER,
            &[
                Value::Str(&spot.callsign),
                Value::Uint(spot.frequency_hz),
                Value::I8(spot.snr_db),
                Value::I8(0),
                Value::Str(&spot.mode),
                Value::Uint(source),
                Value::Str(&spot.locator),
                Value::Uint(spot.time_s),
            ],
        );
        if size + r.len() > MAX_DATAGRAM && !records.is_empty() {
            break;
        }
        size += r.len();
        records.push(r);
    }
    let used = records.len();
    parts.push(data_set(&SENDER, &records));
    let export = u32::try_from(now_s).unwrap_or(u32::MAX);
    (datagram(export, s.sequence, s.domain, &parts), used)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    /// The page's receiver format: receiverCallsign, receiverLocator, decodingSoftware.
    const PAGE_RECEIVER: Format = Format {
        id: 0x9992,
        fields: &[psk(2, VAR), psk(4, VAR), psk(8, VAR)],
        receiver: true,
    };
    /// The page's first sender format: senderCallsign, frequency, mode, informationSource,
    /// flowStartSeconds.
    const PAGE_SENDER: Format = Format {
        id: 0x9993,
        fields: &[
            psk(1, VAR),
            psk(5, 4),
            psk(10, VAR),
            psk(11, 1),
            Field {
                id: 150,
                len: 4,
                enterprise: false,
            },
        ],
        receiver: false,
    };

    fn hex(s: &str) -> Vec<u8> {
        s.split_whitespace()
            .map(|b| u8::from_str_radix(b, 16).unwrap())
            .collect()
    }

    fn page_records(mode: &str) -> Vec<Vec<u8>> {
        vec![
            record(
                &PAGE_SENDER,
                &[
                    Value::Str("N1DQ"),
                    Value::Uint(14_070_567),
                    Value::Str(mode),
                    Value::Uint(1),
                    Value::Uint(1_200_960_084),
                ],
            ),
            record(
                &PAGE_SENDER,
                &[
                    Value::Str("KB1MBX"),
                    Value::Uint(14_070_987),
                    Value::Str(mode),
                    Value::Uint(1),
                    Value::Uint(1_200_960_104),
                ],
            ),
        ]
    }

    fn page_receiver() -> Vec<u8> {
        data_set(
            &PAGE_RECEIVER,
            &[record(
                &PAGE_RECEIVER,
                &[
                    Value::Str("N1DQ"),
                    Value::Str("FN42hn"),
                    Value::Str("Homebrew v5.6"),
                ],
            )],
        )
    }

    #[test]
    fn writes_the_developer_pages_example_datagram_byte_for_byte() {
        let expected = hex(
            "00 0A 00 AC 47 95 32 72 00 00 00 01 00 00 00 00
             00 03 00 24 99 92 00 03 00 01 80 02 FF FF 00 00 76 8F 80 04 FF FF 00 00 76 8F 80 08 FF FF 00 00 76 8F 00 00
             00 02 00 2C 99 93 00 05 80 01 FF FF 00 00 76 8F 80 05 00 04 00 00 76 8F 80 0A FF FF 00 00 76 8F 80 0B 00 01 00 00 76 8F 00 96 00 04
             99 92 00 20 04 4E 31 44 51 06 46 4E 34 32 68 6E 0D 48 6F 6D 65 62 72 65 77 20 76 35 2E 36 00 00
             99 93 00 2C 04 4E 31 44 51 00 D6 B3 27 03 50 53 4B 01 47 95 32 54
             06 4B 42 31 4D 42 58 00 D6 B4 CB 03 50 53 4B 01 47 95 32 68 00 00",
        );
        let parts = vec![
            format_set(&PAGE_RECEIVER),
            format_set(&PAGE_SENDER),
            page_receiver(),
            data_set(&PAGE_SENDER, &page_records("PSK")),
        ];
        assert_eq!(datagram(1_200_960_114, 1, 0, &parts), expected);
    }

    #[test]
    fn writes_the_pages_later_datagram_without_the_formats() {
        // The page's second example spells the mode PSL.
        let expected = hex("00 0A 00 5C 47 95 32 72 00 00 00 04 00 00 00 00
             99 92 00 20 04 4E 31 44 51 06 46 4E 34 32 68 6E 0D 48 6F 6D 65 62 72 65 77 20 76 35 2E 36 00 00
             99 93 00 2C 04 4E 31 44 51 00 D6 B3 27 03 50 53 4C 01 47 95 32 54
             06 4B 42 31 4D 42 58 00 D6 B4 CB 03 50 53 4C 01 47 95 32 68 00 00");
        let parts = vec![page_receiver(), data_set(&PAGE_SENDER, &page_records("PSL"))];
        assert_eq!(datagram(1_200_960_114, 4, 0, &parts), expected);
    }

    #[test]
    fn writes_the_pages_fourth_sender_format() {
        let expected = hex(
            "00 02 00 44 99 93 00 08 80 01 FF FF 00 00 76 8F 80 05 00 04 00 00 76 8F 80 06 00 01 00 00 76 8F
             80 07 00 01 00 00 76 8F 80 0A FF FF 00 00 76 8F 80 0B 00 01 00 00 76 8F 80 03 FF FF 00 00 76 8F 00 96 00 04",
        );
        assert_eq!(format_set(&SENDER), expected);
        assert_eq!(&format_set(&RECEIVER)[..4], &hex("00 03 00 2C"));
    }

    const T0: u64 = 1_792_000_000;
    const RULES: Rules = Rules {
        interval_s: 300,
        test: true,
    };

    fn station() -> Station {
        Station {
            callsign: "9V1NE".into(),
            locator: "OJ11".into(),
            software: "RR73 0.16.2".into(),
            antenna: String::new(),
        }
    }

    fn spot(call: &str, mhz: f64, t: u64) -> Spot {
        Spot {
            callsign: call.into(),
            locator: String::new(),
            frequency_hz: (mhz * 1e6) as u32,
            snr_db: -12,
            mode: "FT8".into(),
            time_s: t as u32,
        }
    }

    /// The sender records of a datagram this reporter wrote: callsign, frequency, informationSource.
    fn senders(d: &[u8]) -> Vec<(String, u32, u8)> {
        let mut at = 16;
        let mut out = Vec::new();
        while at + 4 <= d.len() {
            let id = u16::from_be_bytes([d[at], d[at + 1]]);
            let len = usize::from(u16::from_be_bytes([d[at + 2], d[at + 3]]));
            if id == 0x9993 {
                let end = at + len;
                let mut p = at + 4;
                while p < end && d[p] != 0 {
                    let n = usize::from(d[p]);
                    let call = String::from_utf8(d[p + 1..p + 1 + n].to_vec()).unwrap();
                    p += 1 + n;
                    let freq = u32::from_be_bytes([d[p], d[p + 1], d[p + 2], d[p + 3]]);
                    p += 4 + 2;
                    p += 1 + usize::from(d[p]);
                    let source = d[p];
                    p += 1;
                    p += 1 + usize::from(d[p]);
                    p += 4;
                    out.push((call, freq, source));
                }
            }
            at += len;
        }
        out
    }

    #[test]
    fn sends_at_most_one_datagram_per_interval_with_the_formats_in_the_first_three() {
        let mut r = Reporter::new(RULES);
        let t = r.take(
            T0,
            station(),
            vec![spot("K1ABC", 14.075, T0), spot("JA1XYZ", 14.076, T0)],
        );
        assert_eq!((t.taken, t.repeats), (2, 0));
        assert!(
            (T0 + 150..=T0 + 300).contains(&t.next_report_s),
            "{}",
            t.next_report_s
        );
        assert!(r.due(t.next_report_s - 1).is_empty());
        let first = r.due(t.next_report_s);
        assert_eq!(first.len(), 1);
        let d = &first[0];
        assert!(d.len() < MAX_DATAGRAM);
        assert_eq!(&d[..2], &[0, 10]);
        assert_eq!(
            u32::from_be_bytes([d[8], d[9], d[10], d[11]]),
            0,
            "sequence before any report"
        );
        assert_eq!(&d[16..18], &[0, 3], "receiver format first");
        assert_eq!(
            senders(d),
            vec![
                ("K1ABC".into(), 14_075_000, 0x81),
                ("JA1XYZ".into(), 14_076_000, 0x81)
            ]
        );
        // More spots wait for the interval.
        let sent = t.next_report_s;
        r.take(sent + 10, station(), vec![spot("VK3QRP", 14.077, sent + 10)]);
        assert!(r.due(sent + 299).is_empty());
        let second = r.due(sent + 330);
        assert_eq!(second.len(), 1);
        assert_eq!(
            u32::from_be_bytes([second[0][8], second[0][9], second[0][10], second[0][11]]),
            2
        );
        let st = r.status("9V1NE").unwrap();
        assert_eq!((st.sent, st.datagrams, st.waiting), (3, 2, 0));
    }

    #[test]
    fn reports_a_callsign_once_per_5_min_and_once_an_hour_on_the_same_band() {
        let mut r = Reporter::new(RULES);
        let t = r.take(
            T0,
            station(),
            vec![spot("K1ABC", 14.075, T0), spot("K1ABC", 14.075, T0)],
        );
        assert_eq!((t.taken, t.repeats), (1, 1));
        let sent = t.next_report_s;
        assert_eq!(r.due(sent).len(), 1);
        // Same band within the hour: a repeat. Another band within 5 min: a repeat.
        assert_eq!(
            r.take(sent + 60, station(), vec![spot("K1ABC", 14.075, sent + 60)])
                .repeats,
            1
        );
        assert_eq!(
            r.take(sent + 60, station(), vec![spot("K1ABC", 7.075, sent + 60)])
                .repeats,
            1
        );
        // Another band after 5 min: a change.
        assert_eq!(
            r.take(sent + 301, station(), vec![spot("K1ABC", 7.075, sent + 301)])
                .taken,
            1
        );
        // The same band after an hour: reported again.
        let mut r = Reporter::new(RULES);
        let t = r.take(T0, station(), vec![spot("K1ABC", 14.075, T0)]);
        r.due(t.next_report_s);
        assert_eq!(
            r.take(
                t.next_report_s + 3600,
                station(),
                vec![spot("K1ABC", 14.075, T0 + 4000)]
            )
            .taken,
            1
        );
    }

    #[test]
    fn sends_at_once_when_spots_fill_a_datagram_and_keeps_each_under_1400_bytes() {
        let mut r = Reporter::new(RULES);
        let calls: Vec<Spot> = (0..200).map(|i| spot(&format!("K{i}ABC"), 14.075, T0)).collect();
        r.take(T0, station(), calls);
        let early = r.due(T0 + 1);
        assert!(!early.is_empty(), "a full datagram goes before the timer");
        assert!(early.iter().all(|d| d.len() <= MAX_DATAGRAM));
        let sent: usize = early.iter().map(|d| senders(d).len()).sum();
        let waiting = r.status("9V1NE").unwrap().waiting;
        assert!(
            waiting > 0 && waiting < 70,
            "the rest wait for the timer: {waiting}"
        );
        assert_eq!(sent + waiting, 200);
    }

    #[test]
    fn sends_the_formats_again_after_an_hour_and_not_in_between() {
        let mut r = Reporter::new(Rules {
            interval_s: 300,
            test: false,
        });
        let mut now = T0;
        let mut with_formats = Vec::new();
        for i in 0..16 {
            r.take(now, station(), vec![spot(&format!("K{i}XYZ"), 14.075, now)]);
            now = r.status("9V1NE").unwrap().next_report_s;
            let d = r.due(now);
            assert_eq!(d.len(), 1);
            with_formats.push(d[0][16..18] == [0, 3]);
            assert_eq!(senders(&d[0])[0].2, 1, "no test bit");
        }
        assert_eq!(&with_formats[..4], &[true, true, true, false]);
        let first_again = with_formats
            .iter()
            .skip(3)
            .position(|&f| f)
            .expect("formats within the hour after")
            + 3;
        // The interval is 300 to 330 s, so the hour runs out 11 or 12 datagrams after the third.
        assert!((13..=14).contains(&first_again), "{with_formats:?}");
    }

    #[test]
    fn starts_again_when_the_station_changes_and_drops_idle_streams() {
        let mut r = Reporter::new(RULES);
        r.take(T0, station(), vec![spot("K1ABC", 14.075, T0)]);
        let moved = Station {
            locator: "OJ12".into(),
            ..station()
        };
        r.take(T0 + 10, moved, vec![spot("JA1XYZ", 14.075, T0)]);
        assert_eq!(r.status("9V1NE").unwrap().waiting, 1);
        let next = r.status("9V1NE").unwrap().next_report_s;
        r.due(next);
        r.due(next + STREAM_IDLE_S + 1);
        assert!(r.status("9V1NE").is_none());
    }
}
