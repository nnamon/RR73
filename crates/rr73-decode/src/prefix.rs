//! Callsign prefixes and where their stations sit, for the OSD locator check (experiment 0015).
//!
//! `data/prefixes.txt` is written by `tools/refdata/prefixes.mjs` from the Big CTY country file
//! the app ships (`refdata/bigcty`, MIT licence). Each prefix lists the positions of the DXCC
//! entities its stations may operate from: its own entity and the entities of the exact
//! callsigns that start with it, so a W call may sit in Hawaii or Alaska. A random codeword
//! carries a callsign whose prefix maps to one country and a locator anywhere on the globe; a
//! station sends a locator within a few thousand km of its entity.

use std::collections::HashMap;
use std::sync::OnceLock;

use rr73_ft8::Callsign;
use rr73_ft8::message::Grid;

const DATA: &str = include_str!("../data/prefixes.txt");

/// Mean Earth radius, km.
const EARTH_KM: f32 = 6371.0;

struct Table {
    /// Positions as (latitude, longitude) in radians.
    positions: Vec<(f32, f32)>,
    /// Prefix to the positions its stations may sit at, by index into `positions`, its own
    /// entity first.
    prefixes: HashMap<&'static str, Entry>,
    /// Longest prefix, in characters.
    longest: usize,
}

struct Entry {
    /// A country whose prefixes span several CQ zones, which the check exempts.
    exempt: bool,
    /// Indices into [`Table::positions`].
    at: Vec<u16>,
}

fn table() -> &'static Table {
    static TABLE: OnceLock<Table> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut positions = Vec::new();
        let mut prefixes = HashMap::new();
        let mut longest = 0;
        for line in DATA.lines().filter(|l| !l.starts_with('#')) {
            let mut words = line.split_ascii_whitespace();
            let Some(first) = words.next() else { continue };
            if first == "@" {
                let mut deg = words.filter_map(|w| w.parse::<f32>().ok());
                if let (Some(lat), Some(lon)) = (deg.next(), deg.next()) {
                    positions.push((lat.to_radians(), lon.to_radians()));
                }
            } else {
                let words: Vec<&str> = words.collect();
                let exempt = words.first() == Some(&"*");
                let at = words.iter().filter_map(|w| w.parse().ok()).collect();
                longest = longest.max(first.len());
                prefixes.insert(first, Entry { exempt, at });
            }
        }
        Table {
            positions,
            prefixes,
            longest,
        }
    })
}

/// The callsign without a `/R` or `/P` flag.
fn base(call: &Callsign) -> &str {
    let s = call.as_str();
    s.strip_suffix("/R").or_else(|| s.strip_suffix("/P")).unwrap_or(s)
}

/// The entry of the longest prefix of `call` in the table, or `None` when no prefix matches.
fn entry(call: &Callsign) -> Option<&'static Entry> {
    let t = table();
    let s = base(call);
    (1..=s.len().min(t.longest))
        .rev()
        .find_map(|n| s.get(..n).and_then(|p| t.prefixes.get(p)))
}

/// `true` when some prefix of `call` belongs to a DXCC entity in the country file.
pub fn has_entity(call: &Callsign) -> bool {
    entry(call).is_some()
}

/// The position of the DXCC entity the prefix of `call` belongs to, (latitude, longitude) in
/// degrees, north and east positive. The bench places the locators of synthetic messages there.
pub fn home(call: &Callsign) -> Option<(f32, f32)> {
    let p = table().positions.get(usize::from(*entry(call)?.at.first()?))?;
    Some((p.0.to_degrees(), p.1.to_degrees()))
}

/// The centre of a 4-character locator, (latitude, longitude) in radians.
fn grid_centre(grid: &Grid) -> (f32, f32) {
    let g = grid.as_str().as_bytes();
    let lon = f32::from(g[0] - b'A') * 20.0 - 180.0 + f32::from(g[2] - b'0') * 2.0 + 1.0;
    let lat = f32::from(g[1] - b'A') * 10.0 - 90.0 + f32::from(g[3] - b'0') + 0.5;
    (lat.to_radians(), lon.to_radians())
}

/// Great-circle distance between two positions in radians, in km.
fn distance_km(a: (f32, f32), b: (f32, f32)) -> f32 {
    let h = ((b.0 - a.0) / 2.0).sin().powi(2) + a.0.cos() * b.0.cos() * ((b.1 - a.1) / 2.0).sin().powi(2);
    2.0 * EARTH_KM * h.sqrt().min(1.0).asin()
}

/// Distance from the centre of `grid` to the nearest entity the prefix of `call` may sit in,
/// in km. `None` when no prefix of `call` is in the country file, and for a country whose
/// prefixes span several CQ zones (the USA, Canada, Russia, China, Australia, Antarctica).
pub fn locator_distance_km(call: &Callsign, grid: &Grid) -> Option<f32> {
    let t = table();
    let at = grid_centre(grid);
    let e = entry(call).filter(|e| !e.exempt)?;
    e.at.iter()
        .filter_map(|&i| t.positions.get(usize::from(i)))
        .map(|&p| distance_km(at, p))
        .reduce(f32::min)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(s: &str) -> Callsign {
        Callsign::new(s).expect(s)
    }

    fn km(c: &str, g: &str) -> Option<f32> {
        locator_distance_km(&call(c), &Grid::new(g).expect(g))
    }

    #[test]
    fn the_table_holds_the_country_file() {
        let t = table();
        assert!(t.positions.len() > 300, "{} positions", t.positions.len());
        assert!(t.prefixes.len() > 6000, "{} prefixes", t.prefixes.len());
    }

    #[test]
    fn prefixes_map_to_their_entities() {
        for c in [
            "9V1NE", "K1ABC", "W9XYZ", "JA1KXM", "VK3QRP", "1A0KM", "2E0ABC", "UA0FF",
        ] {
            assert!(has_entity(&call(c)), "{c}");
        }
        for c in ["X14BED", "Y10TKZ", "JZ1EPT"] {
            assert!(!has_entity(&call(c)), "{c}");
        }
    }

    #[test]
    fn a_station_near_home_is_close_and_a_random_locator_is_far() {
        let near = |c: &str, g: &str| km(c, g).is_some_and(|d| d < 1000.0);
        assert!(near("9V1NE", "OJ11"), "{:?}", km("9V1NE", "OJ11"));
        assert!(near("G4ABC", "IO91"), "{:?}", km("G4ABC", "IO91"));
        assert!(near("DL1ABC/R", "JO62"), "{:?}", km("DL1ABC/R", "JO62"));
        assert!(near("JA1KXM", "PM95"), "{:?}", km("JA1KXM", "PM95"));
        assert!(near("KH6ABC", "BL11"), "{:?}", km("KH6ABC", "BL11"));
        assert!(km("TP2VHE/R", "QF76").is_some_and(|d| d > 15000.0));
        assert!(km("A24MJW", "FF25").is_some_and(|d| d > 9000.0));
    }

    #[test]
    fn countries_spanning_several_zones_and_unknown_prefixes_have_no_distance() {
        for (c, g) in [
            ("K1ABC", "BL11"),
            ("W7ABC", "FN42"),
            ("VE7ABC", "FN25"),
            ("UA0FF", "IO63"),
            ("VK6ABC", "QF22"),
            ("BY1ABC", "OL72"),
            ("X14BED", "HM23"),
        ] {
            assert_eq!(km(c, g), None, "{c} {g}");
        }
    }

    #[test]
    fn distance_is_a_great_circle() {
        let london = (51.5f32.to_radians(), (-0.1f32).to_radians());
        let new_york = (40.7f32.to_radians(), (-74.0f32).to_radians());
        assert!((distance_km(london, new_york) - 5570.0).abs() < 30.0);
    }
}
