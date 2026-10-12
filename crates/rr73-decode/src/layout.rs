//! Frame layout of FT8 and FT4 transmissions as the decoder uses it: physical parameters,
//! sync groups, data symbol order and the Gray map.

use rr73_ft8::Mode;
use rr73_ft8::tones::{self, FT4_COSTAS, FT4_GRAY, FT8_COSTAS, FT8_COSTAS_STARTS, FT8_GRAY};

/// Channel symbol index where each FT4 sync group starts, counting the leading ramp symbol
/// as symbol 0 (105-symbol frame).
pub const FT4_SYNC_STARTS: [usize; 4] = [1, 34, 67, 100];

/// Number of LLRs per candidate: the (174,91) codeword length.
pub const CODEWORD_BITS: usize = rr73_ft8::ldpc::N;

/// A run of consecutive sync symbols with known tones.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SyncGroup {
    /// Channel symbol index of the first sync symbol.
    pub start: usize,
    /// Expected tone of each symbol in the group.
    pub tones: Vec<u8>,
}

/// Layout and physical parameters of one mode.
#[derive(Clone, Debug, PartialEq)]
pub struct FrameLayout {
    /// The mode.
    pub mode: Mode,
    /// Tones in the alphabet (8 for FT8, 4 for FT4).
    pub tones: usize,
    /// Code bits per data symbol (3 for FT8, 2 for FT4).
    pub bits_per_symbol: usize,
    /// Channel symbols per transmission, including sync and ramp symbols.
    pub symbols: usize,
    /// Samples per symbol at 12 kHz.
    pub samples_per_symbol: usize,
    /// Tone spacing in Hz.
    pub tone_spacing_hz: f32,
    /// Slot length in seconds.
    pub slot_s: f32,
    /// Nominal start of a transmission after the slot boundary, in seconds.
    pub start_offset_s: f32,
    /// Sync groups in transmission order.
    pub sync: Vec<SyncGroup>,
    /// Channel symbol index of each data symbol, in codeword order.
    pub data: Vec<usize>,
    /// Gray map: `gray[v]` is the tone that carries the code bits with value `v`.
    pub gray: Vec<u8>,
}

impl FrameLayout {
    /// The layout of `mode`, from the protocol tables in `rr73-ft8`.
    pub fn new(mode: Mode) -> Self {
        let p = mode.params();
        let (sync, gray) = match mode {
            Mode::Ft8 => (
                FT8_COSTAS_STARTS
                    .iter()
                    .map(|&start| SyncGroup {
                        start,
                        tones: FT8_COSTAS.to_vec(),
                    })
                    .collect(),
                FT8_GRAY.to_vec(),
            ),
            Mode::Ft4 => (
                FT4_SYNC_STARTS
                    .iter()
                    .zip(FT4_COSTAS.iter())
                    .map(|(&start, t)| SyncGroup {
                        start,
                        tones: t.to_vec(),
                    })
                    .collect(),
                FT4_GRAY.to_vec(),
            ),
        };
        Self {
            mode,
            tones: p.tones,
            bits_per_symbol: p.tones.trailing_zeros() as usize,
            symbols: p.symbols,
            samples_per_symbol: p.samples_per_symbol,
            tone_spacing_hz: p.tone_spacing_hz,
            slot_s: p.slot_s,
            start_offset_s: p.start_offset_s,
            sync,
            data: tones::data_symbols(mode),
            gray,
        }
    }

    /// Symbol length in seconds.
    pub fn symbol_s(&self) -> f32 {
        self.samples_per_symbol as f32 / 12_000.0
    }

    /// Samples in one slot at 12 kHz.
    pub fn slot_samples(&self) -> usize {
        (self.slot_s * 12_000.0).round() as usize
    }

    /// Checks internal consistency: the data symbols carry exactly one codeword, the Gray
    /// map is a permutation of the tones, and every symbol index is inside the frame.
    pub fn check(&self) -> Result<(), String> {
        if self.tones < 2 || !self.tones.is_power_of_two() || 1 << self.bits_per_symbol != self.tones {
            return Err(format!(
                "{} tones with {} bits per symbol",
                self.tones, self.bits_per_symbol
            ));
        }
        if self.data.len() * self.bits_per_symbol != CODEWORD_BITS {
            return Err(format!(
                "{} data symbols carry {} bits, codeword has {CODEWORD_BITS}",
                self.data.len(),
                self.data.len() * self.bits_per_symbol
            ));
        }
        let mut seen = vec![false; self.tones];
        for &t in &self.gray {
            match seen.get_mut(t as usize) {
                Some(s) if !*s => *s = true,
                _ => return Err("Gray map is not a permutation of the tones".into()),
            }
        }
        if self.gray.len() != self.tones {
            return Err("Gray map length differs from tone count".into());
        }
        let mut used = vec![false; self.symbols];
        let sync_symbols = self
            .sync
            .iter()
            .flat_map(|g| (0..g.tones.len()).map(move |k| (g.start + k, g.tones[k])));
        for (s, tone) in sync_symbols {
            if s >= self.symbols || used[s] || tone as usize >= self.tones {
                return Err(format!(
                    "sync symbol {s} out of range, repeated or with tone {tone}"
                ));
            }
            used[s] = true;
        }
        for &s in &self.data {
            if s >= self.symbols || used[s] {
                return Err(format!("data symbol {s} out of range or overlapping sync"));
            }
            used[s] = true;
        }
        let positive = |x: f32| x.is_finite() && x > 0.0;
        if self.samples_per_symbol == 0 || !positive(self.tone_spacing_hz) || !positive(self.slot_s) {
            return Err("non-positive physical parameter".into());
        }
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod test_layouts {
    //! Hand-written layouts for tests that must run without the codec's mode tables.
    use super::*;

    /// FT8 as described in the protocol paper: 79 symbols of 1920 samples, 6.25 Hz spacing,
    /// Costas arrays at 0, 36 and 72.
    pub fn ft8() -> FrameLayout {
        let data = (7..36).chain(43..72).collect();
        FrameLayout {
            mode: Mode::Ft8,
            tones: 8,
            bits_per_symbol: 3,
            symbols: 79,
            samples_per_symbol: 1920,
            tone_spacing_hz: 6.25,
            slot_s: 15.0,
            start_offset_s: 0.5,
            sync: FT8_COSTAS_STARTS
                .iter()
                .map(|&start| SyncGroup {
                    start,
                    tones: FT8_COSTAS.to_vec(),
                })
                .collect(),
            data,
            gray: FT8_GRAY.to_vec(),
        }
    }

    /// FT4: 105 symbols (ramp, 4 sync groups of 4, 3 data blocks of 29, ramp) of 576
    /// samples, 20.833 Hz spacing.
    pub fn ft4() -> FrameLayout {
        let data = (5..34).chain(38..67).chain(71..100).collect();
        FrameLayout {
            mode: Mode::Ft4,
            tones: 4,
            bits_per_symbol: 2,
            symbols: 105,
            samples_per_symbol: 576,
            tone_spacing_hz: 12_000.0 / 576.0,
            slot_s: 7.5,
            start_offset_s: 0.5,
            sync: FT4_SYNC_STARTS
                .iter()
                .zip(FT4_COSTAS.iter())
                .map(|(&start, t)| SyncGroup {
                    start,
                    tones: t.to_vec(),
                })
                .collect(),
            data,
            gray: FT4_GRAY.to_vec(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hand_written_layouts_are_consistent() {
        test_layouts::ft8().check().expect("ft8");
        test_layouts::ft4().check().expect("ft4");
        assert_eq!(test_layouts::ft8().slot_samples(), 180_000);
        assert!((test_layouts::ft8().symbol_s() - 0.16).abs() < 1e-6);
    }

    #[test]
    fn check_catches_broken_layouts() {
        let mut l = test_layouts::ft8();
        l.data.pop();
        assert!(l.check().is_err());
        let mut l = test_layouts::ft8();
        l.gray[0] = l.gray[1];
        assert!(l.check().is_err());
        let mut l = test_layouts::ft8();
        l.data[0] = 0;
        assert!(l.check().is_err());
        let mut l = test_layouts::ft4();
        l.sync[3].start = 102;
        assert!(l.check().is_err());
    }
}
