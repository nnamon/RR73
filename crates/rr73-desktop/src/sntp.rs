//! SNTP (RFC 4330): the offset of the system clock from an NTP server.
//!
//! One exchange sends a 48-byte client request carrying the local time `t1` in its transmit
//! field. The server answers with `t1` copied to its originate field, the time it received the
//! request (`t2`) and the time it sent the reply (`t3`). The reply arrives at local time `t4`.
//! The offset of the server's clock from the local clock is ((t2 - t1) + (t3 - t4)) / 2 and the
//! round-trip delay (t4 - t1) - (t3 - t2). The error of the offset is at most half the delay, so
//! [`measure`] keeps the exchange with the shortest delay.
//!
//! A reply is refused when it is shorter than 48 bytes, is not a server or broadcast reply, has
//! stratum 0 (a kiss-o'-death) or above 15, reports an unsynchronised clock (leap indicator 3),
//! carries another originate time than the request's (a stray or forged reply), or has a zero
//! transmit time.

use std::io;
use std::net::{ToSocketAddrs, UdpSocket};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// The NTP port.
pub const PORT: u16 = 123;
/// Seconds from 1900-01-01 (the NTP epoch) to 1970-01-01.
const NTP_UNIX_S: u64 = 2_208_988_800;
/// Seconds in one NTP era (2^32).
const ERA_S: f64 = 4_294_967_296.0;
/// Length of an SNTP packet without extensions, bytes.
pub const PACKET_LEN: usize = 48;

/// One NTP timestamp: seconds since 1900 in the high 32 bits, fractions of a second in the low.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Timestamp(pub u64);

impl Timestamp {
    /// The timestamp of `unix_ms`, ms since 1970-01-01 UTC.
    pub fn from_unix_ms(unix_ms: f64) -> Self {
        let s = unix_ms / 1000.0 + NTP_UNIX_S as f64;
        let secs = s.floor();
        let frac = ((s - secs) * ERA_S).floor();
        Self(((secs.rem_euclid(ERA_S) as u64) << 32) | (frac as u64 & 0xffff_ffff))
    }

    /// The time in ms since 1970-01-01 UTC, taking the NTP era nearest `near_unix_ms`. Era 0 ends
    /// in 2036; the reference time keeps the arithmetic right across that.
    pub fn to_unix_ms(self, near_unix_ms: f64) -> f64 {
        let in_era = (self.0 >> 32) as f64 + (self.0 & 0xffff_ffff) as f64 / ERA_S;
        let near = near_unix_ms / 1000.0 + NTP_UNIX_S as f64;
        let era = ((near - in_era) / ERA_S).round();
        (in_era + era * ERA_S - NTP_UNIX_S as f64) * 1000.0
    }
}

/// One exchange with a server.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    /// Server clock minus local clock, ms: add it to the local time to get the server's.
    pub offset_ms: f64,
    /// Round-trip delay of the exchange without the server's processing time, ms.
    pub delay_ms: f64,
    /// The server's stratum: 1 for a server with its own reference clock.
    pub stratum: u8,
}

/// Why an exchange gave no sample.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum SntpError {
    /// The name did not resolve, the socket failed, or no reply came in time.
    #[error("no reply: {0}")]
    Network(String),
    /// The reply broke one of the rules in the module documentation.
    #[error("refused reply: {0}")]
    Refused(&'static str),
}

impl From<io::Error> for SntpError {
    fn from(e: io::Error) -> Self {
        Self::Network(e.to_string())
    }
}

/// A client request sent at `t1`: leap indicator 0, version 4, mode 3 (client).
pub fn request(t1: Timestamp) -> [u8; PACKET_LEN] {
    let mut p = [0u8; PACKET_LEN];
    p[0] = 0x23;
    p[40..48].copy_from_slice(&t1.0.to_be_bytes());
    p
}

fn stamp(p: &[u8], at: usize) -> Timestamp {
    let mut b = [0u8; 8];
    b.copy_from_slice(&p[at..at + 8]);
    Timestamp(u64::from_be_bytes(b))
}

/// The sample from a reply to a request sent at `t1_unix_ms` and received at `t4_unix_ms`
/// (local clock, ms since 1970).
pub fn parse(reply: &[u8], t1: Timestamp, t1_unix_ms: f64, t4_unix_ms: f64) -> Result<Sample, SntpError> {
    if reply.len() < PACKET_LEN {
        return Err(SntpError::Refused("short packet"));
    }
    let leap = reply[0] >> 6;
    let mode = reply[0] & 0x07;
    let stratum = reply[1];
    if mode != 4 && mode != 5 {
        return Err(SntpError::Refused("not a server reply"));
    }
    if leap == 3 {
        return Err(SntpError::Refused("server clock not synchronised"));
    }
    if stratum == 0 || stratum > 15 {
        return Err(SntpError::Refused("bad stratum"));
    }
    if stamp(reply, 24) != t1 {
        return Err(SntpError::Refused("reply to another request"));
    }
    let t3 = stamp(reply, 40);
    if t3.0 == 0 {
        return Err(SntpError::Refused("no transmit time"));
    }
    let t2 = stamp(reply, 32).to_unix_ms(t1_unix_ms);
    let t3 = t3.to_unix_ms(t1_unix_ms);
    Ok(Sample {
        offset_ms: ((t2 - t1_unix_ms) + (t3 - t4_unix_ms)) / 2.0,
        delay_ms: (t4_unix_ms - t1_unix_ms) - (t3 - t2),
        stratum,
    })
}

/// The local clock, ms since 1970-01-01.
pub fn now_unix_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// One exchange with `server` (a host name or address, port 123), waiting `timeout` for the reply.
pub fn query(server: &str, timeout: Duration) -> Result<Sample, SntpError> {
    let addr = (server, PORT)
        .to_socket_addrs()?
        .next()
        .ok_or_else(|| SntpError::Network("no address".into()))?;
    let socket = UdpSocket::bind(if addr.is_ipv4() { "0.0.0.0:0" } else { "[::]:0" })?;
    socket.set_read_timeout(Some(timeout))?;
    socket.connect(addr)?;
    let t1_ms = now_unix_ms();
    let t1 = Timestamp::from_unix_ms(t1_ms);
    socket.send(&request(t1))?;
    let mut buf = [0u8; 512];
    loop {
        let n = socket.recv(&mut buf)?;
        let t4_ms = now_unix_ms();
        match parse(&buf[..n], t1, t1_ms, t4_ms) {
            // A stray datagram: keep waiting for the reply within the timeout.
            Err(SntpError::Refused("reply to another request")) => continue,
            other => return other,
        }
    }
}

/// The sample with the shortest delay of `samples`, or None when there is none.
pub fn best(samples: &[Sample]) -> Option<Sample> {
    samples
        .iter()
        .copied()
        .filter(|s| s.delay_ms.is_finite() && s.delay_ms >= 0.0)
        .min_by(|a, b| a.delay_ms.total_cmp(&b.delay_ms))
}

/// Up to `tries` exchanges with `server`, `gap` apart; the one with the shortest delay. Fails with
/// the last error when no exchange gave a sample.
pub fn measure(server: &str, tries: usize, timeout: Duration, gap: Duration) -> Result<Sample, SntpError> {
    let mut samples = Vec::new();
    let mut last = SntpError::Network("no exchange".into());
    for i in 0..tries {
        if i > 0 {
            std::thread::sleep(gap);
        }
        match query(server, timeout) {
            Ok(s) => samples.push(s),
            Err(e) => last = e,
        }
    }
    best(&samples).ok_or(last)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A reply from a server whose clock is `offset_ms` ahead, `server_ms` after receiving.
    fn reply(t1: Timestamp, t2_ms: f64, t3_ms: f64) -> [u8; PACKET_LEN] {
        let mut p = [0u8; PACKET_LEN];
        p[0] = 0x24; // leap 0, version 4, mode 4
        p[1] = 2;
        p[24..32].copy_from_slice(&t1.0.to_be_bytes());
        p[32..40].copy_from_slice(&Timestamp::from_unix_ms(t2_ms).0.to_be_bytes());
        p[40..48].copy_from_slice(&Timestamp::from_unix_ms(t3_ms).0.to_be_bytes());
        p
    }

    const T1: f64 = 1_792_000_000_000.0; // 2026-10-15

    #[test]
    fn timestamps_round_trip_to_well_under_a_millisecond() {
        for ms in [0.0, 1_000.5, T1, T1 + 0.25, 2_085_978_496_000.0 + 1234.5] {
            let back = Timestamp::from_unix_ms(ms).to_unix_ms(ms);
            assert!((back - ms).abs() < 0.001, "{ms} came back as {back}");
        }
    }

    #[test]
    fn era_1_timestamps_resolve_near_the_reference() {
        // 2036-02-07 06:28:16 UTC starts era 1; a time a minute after it.
        let after = 2_085_978_496_000.0 + 60_000.0;
        let ts = Timestamp::from_unix_ms(after);
        assert!(ts.0 >> 32 < 100);
        assert!((ts.to_unix_ms(after - 3_600_000.0) - after).abs() < 0.001);
    }

    #[test]
    fn request_is_a_version_4_client_packet_with_t1() {
        let t1 = Timestamp::from_unix_ms(T1);
        let p = request(t1);
        assert_eq!(p[0], 0x23);
        assert_eq!(stamp(&p, 40), t1);
    }

    #[test]
    fn offset_and_delay_follow_rfc_4330() {
        // Server 1500 ms ahead; 20 ms each way; 1 ms in the server.
        let t1 = Timestamp::from_unix_ms(T1);
        let t2 = T1 + 20.0 + 1500.0;
        let t3 = t2 + 1.0;
        let t4 = T1 + 41.0;
        let s = parse(&reply(t1, t2, t3), t1, T1, t4).expect("accepted");
        assert!((s.offset_ms - 1500.0).abs() < 0.01, "{s:?}");
        assert!((s.delay_ms - 40.0).abs() < 0.01, "{s:?}");
        assert_eq!(s.stratum, 2);
    }

    #[test]
    fn a_slow_local_clock_gives_a_negative_offset() {
        let t1 = Timestamp::from_unix_ms(T1);
        let t2 = T1 + 10.0 - 2000.0;
        let s = parse(&reply(t1, t2, t2), t1, T1, T1 + 20.0).expect("accepted");
        assert!((s.offset_ms + 2000.0).abs() < 0.01, "{s:?}");
    }

    #[test]
    fn bad_replies_are_refused() {
        let t1 = Timestamp::from_unix_ms(T1);
        let good = reply(t1, T1 + 10.0, T1 + 10.0);
        assert_eq!(
            parse(&good[..40], t1, T1, T1 + 20.0),
            Err(SntpError::Refused("short packet"))
        );
        let mut p = good;
        p[0] = 0x23;
        assert_eq!(
            parse(&p, t1, T1, T1 + 20.0),
            Err(SntpError::Refused("not a server reply"))
        );
        let mut p = good;
        p[0] = 0xe4;
        assert_eq!(
            parse(&p, t1, T1, T1 + 20.0),
            Err(SntpError::Refused("server clock not synchronised"))
        );
        let mut p = good;
        p[1] = 0;
        assert_eq!(
            parse(&p, t1, T1, T1 + 20.0),
            Err(SntpError::Refused("bad stratum"))
        );
        let other = Timestamp::from_unix_ms(T1 + 1.0);
        assert_eq!(
            parse(&good, other, T1, T1 + 20.0),
            Err(SntpError::Refused("reply to another request"))
        );
        let mut p = good;
        p[40..48].fill(0);
        assert_eq!(
            parse(&p, t1, T1, T1 + 20.0),
            Err(SntpError::Refused("no transmit time"))
        );
    }

    #[test]
    fn best_keeps_the_shortest_delay() {
        let s = |offset_ms, delay_ms| Sample {
            offset_ms,
            delay_ms,
            stratum: 1,
        };
        assert_eq!(
            best(&[s(12.0, 80.0), s(3.0, 15.0), s(40.0, 300.0)]),
            Some(s(3.0, 15.0))
        );
        assert_eq!(best(&[s(1.0, -5.0)]), None);
        assert_eq!(best(&[]), None);
    }
}
