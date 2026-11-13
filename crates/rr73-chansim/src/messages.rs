//! Random standard messages for simulated traffic.
//!
//! Callsigns follow the standard pattern the 28-bit callsign field encodes: a prefix of one
//! letter, two letters, or a digit and a letter, then an area digit, then one to three
//! letters (K1ABC, JA1XYZ, 9V1NE). Two layouts that the field reserves for other prefixes
//! are never generated: Q followed by a letter (stands for 3X) and 3D0 (stands for 3DA0). Messages are the QSO forms of i3 = 1: CQ with a grid,
//! a call pair with a grid, a report, an R-report, RRR, RR73 or 73.

use rand::Rng;
use std::sync::RwLock;

const LETTERS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS: &[u8] = b"0123456789";

fn pick<R: Rng>(rng: &mut R, set: &[u8]) -> char {
    set[rng.random_range(0..set.len())] as char
}

/// A random standard callsign.
pub fn callsign<R: Rng>(rng: &mut R) -> String {
    loop {
        let s = candidate_callsign(rng);
        let b = s.as_bytes();
        let reserved = (b[0] == b'Q' && b[1].is_ascii_uppercase()) || s.starts_with("3D0");
        if !reserved {
            return s;
        }
    }
}

fn candidate_callsign<R: Rng>(rng: &mut R) -> String {
    let mut s = String::new();
    match rng.random_range(0..3) {
        0 => s.push(pick(rng, LETTERS)),
        1 => {
            s.push(pick(rng, LETTERS));
            s.push(pick(rng, LETTERS));
        }
        _ => {
            s.push(pick(rng, DIGITS));
            s.push(pick(rng, LETTERS));
        }
    }
    s.push(pick(rng, DIGITS));
    for _ in 0..rng.random_range(1..=3) {
        s.push(pick(rng, LETTERS));
    }
    s
}

/// A random 4-character Maidenhead grid, never `RR73`.
pub fn grid<R: Rng>(rng: &mut R) -> String {
    loop {
        let g: String = [
            pick(rng, &LETTERS[..18]),
            pick(rng, &LETTERS[..18]),
            pick(rng, DIGITS),
            pick(rng, DIGITS),
        ]
        .iter()
        .collect();
        if g != "RR73" {
            return g;
        }
    }
}

/// Where a synthetic station sends its locator from: (latitude, longitude) in degrees for a
/// callsign, or `None` for a random locator.
pub type HomeFn = fn(&str) -> Option<(f32, f32)>;

static HOME: RwLock<Option<HomeFn>> = RwLock::new(None);

/// Sets where every later [`locator`] call places a station; `None` restores random locators.
/// The bench sets it from the country file for realistic synthetic sets (experiment 0015).
pub fn set_home(home: Option<HomeFn>) {
    if let Ok(mut h) = HOME.write() {
        *h = home;
    }
}

/// The locator `sender` sends: a random grid, or with [`set_home`] one within about 300 km of
/// the sender's home. Both draw the same random values, so the rest of a slot is the same in
/// both modes: the home locator takes its offset from the random grid's digits.
pub fn locator<R: Rng>(rng: &mut R, sender: &str) -> String {
    let random = grid(rng);
    let home = HOME.read().ok().and_then(|h| *h).and_then(|f| f(sender));
    let Some((lat, lon)) = home else { return random };
    near(lat, lon, &random)
}

/// The locator within about 300 km of (`lat`, `lon`) in degrees, offset by the digits of
/// `random`, a random locator; `random` itself where the result would read `RR73`.
fn near(lat: f32, lon: f32, random: &str) -> String {
    let d = random.as_bytes();
    let lat = (lat + (f32::from(d[3] - b'0') - 4.5) * 0.5).clamp(-89.9, 89.9);
    let lon = (lon + (f32::from(d[2] - b'0') - 4.5) * 0.7 + 540.0).rem_euclid(360.0) - 180.0;
    let field = |v: f32, size: f32| ((v / size) as u8).min(17);
    let (x, y) = (lon + 180.0, lat + 90.0);
    let (fx, fy) = (field(x, 20.0), field(y, 10.0));
    let sx = (((x - f32::from(fx) * 20.0) / 2.0) as u8).min(9);
    let sy = ((y - f32::from(fy) * 10.0) as u8).min(9);
    let g: String = [b'A' + fx, b'A' + fy, b'0' + sx, b'0' + sy]
        .iter()
        .map(|&c| c as char)
        .collect();
    if g == "RR73" { random.to_string() } else { g }
}

/// A random signal report from -24 to +15 dB, formatted as FT8 sends it (`-07`, `+12`).
pub fn report<R: Rng>(rng: &mut R) -> String {
    format!("{:+03}", rng.random_range(-24..=15))
}

/// A random standard QSO message.
pub fn message<R: Rng>(rng: &mut R) -> String {
    let a = callsign(rng);
    let b = callsign(rng);
    match rng.random_range(0..8) {
        0 | 1 => format!("CQ {a} {}", locator(rng, &a)),
        2 => format!("{a} {b} {}", locator(rng, &b)),
        3 => format!("{a} {b} {}", report(rng)),
        4 => format!("{a} {b} R{}", report(rng)),
        5 => format!("{a} {b} RRR"),
        6 => format!("{a} {b} RR73"),
        _ => format!("{a} {b} 73"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    #[test]
    fn home_locators_lie_near_home() {
        // Singapore, London, Honolulu, the date line and the poles.
        assert_eq!(near(1.3, 103.8, "AA44"), "OJ11");
        assert_eq!(near(51.5, -0.1, "AA44"), "IO91");
        assert_eq!(near(21.3, -157.9, "AA44"), "BL01");
        assert_eq!(near(0.0, 179.9, "AA99"), "AJ12");
        assert_eq!(&near(89.9, 0.0, "AA99")[1..2], "R");
        assert_eq!(&near(-89.9, 0.0, "AA00")[1..2], "A");
    }

    #[test]
    fn callsigns_match_the_standard_pattern() {
        let mut rng = ChaCha8Rng::seed_from_u64(5);
        for _ in 0..2000 {
            let c = callsign(&mut rng);
            let b = c.as_bytes();
            let digit = b.iter().rposition(u8::is_ascii_digit).expect("area digit");
            assert!((1..=2).contains(&digit), "{c}");
            assert!(b[..digit].iter().all(u8::is_ascii_alphanumeric), "{c}");
            assert!(b[..digit].iter().any(u8::is_ascii_uppercase), "{c}");
            assert!(
                !(b[0] == b'Q' && b[1].is_ascii_uppercase()) && !c.starts_with("3D0"),
                "{c}"
            );
            let suffix = &b[digit + 1..];
            assert!(
                (1..=3).contains(&suffix.len()) && suffix.iter().all(u8::is_ascii_uppercase),
                "{c}"
            );
        }
    }

    #[test]
    fn grids_reports_and_messages_are_well_formed() {
        let mut rng = ChaCha8Rng::seed_from_u64(6);
        for _ in 0..2000 {
            let g = grid(&mut rng);
            let b = g.as_bytes();
            assert!(
                b[0] <= b'R' && b[1] <= b'R' && b[2].is_ascii_digit() && b[3].is_ascii_digit(),
                "{g}"
            );
            let r: i32 = report(&mut rng).parse().expect("report");
            assert!((-24..=15).contains(&r));
            let m = message(&mut rng);
            assert!((3..=4).contains(&m.split(' ').count()), "{m}");
        }
    }

    #[test]
    fn same_seed_same_messages() {
        let a: Vec<String> = (0..5)
            .map(|_| message(&mut ChaCha8Rng::seed_from_u64(9)))
            .collect();
        assert!(a.windows(2).all(|w| w[0] == w[1]));
    }
}
