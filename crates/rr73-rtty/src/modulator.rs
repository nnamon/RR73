//! Continuous-phase AFSK: keys the mark and space tones from ITA2 characters.
//!
//! The tone frequency moves between mark and space along a raised-cosine curve over a
//! fraction of a bit, and the amplitude rises and falls along raised-cosine ramps at the start
//! and end of a transmission. Both keep the spectrum close to the keyed pair.

use std::collections::VecDeque;
use std::f64::consts::{PI, TAU};

use serde::{Deserialize, Serialize};

use crate::config::{ConfigError, DEFAULT_MARK_HZ, RttyParams, check_range, check_tone};
use crate::ita2::{Case, LTRS, TextEncoder};

/// What the modulator sends while it has no text.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Idle {
    /// LTRS characters back to back (the diddle). Keeps receivers in step and in letters case.
    #[default]
    Diddle,
    /// Steady mark.
    Mark,
}

/// Transmit settings.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct TxConfig {
    /// Line code and keying.
    pub params: RttyParams,
    /// Mark tone, in Hz. The space tone follows from the shift and polarity.
    pub mark_hz: f64,
    /// Output sample rate, in Hz: 12000 for the bench, the audio output's rate in the app.
    pub sample_rate: f64,
    /// Time the frequency takes to move between mark and space, in bits (0 to 1).
    pub transition_bits: f64,
    /// Amplitude ramp at the start and end of a transmission, in seconds.
    pub ramp_s: f64,
    /// LTRS characters sent before the text.
    pub preamble_chars: u32,
    /// LTRS characters sent after the text.
    pub postamble_chars: u32,
    /// What to send while the text queue is empty.
    pub idle: Idle,
    /// Peak amplitude (0 to 1).
    pub amplitude: f32,
}

impl Default for TxConfig {
    fn default() -> Self {
        Self {
            params: RttyParams::default(),
            mark_hz: DEFAULT_MARK_HZ,
            sample_rate: crate::SAMPLE_RATE,
            transition_bits: 0.25,
            ramp_s: 0.005,
            preamble_chars: 3,
            postamble_chars: 1,
            idle: Idle::Diddle,
            amplitude: 1.0,
        }
    }
}

impl TxConfig {
    /// Checks every field against the supported ranges.
    pub fn check(&self) -> Result<(), ConfigError> {
        self.params.check()?;
        check_tone(self.mark_hz)?;
        check_tone(self.params.space_hz(self.mark_hz))?;
        // The higher tone must sit well below the Nyquist frequency.
        let top = self.mark_hz.max(self.params.space_hz(self.mark_hz));
        check_range(
            "sample_rate",
            self.sample_rate,
            (2.2 * top).max(8000.0),
            192_000.0,
        )?;
        check_range("transition_bits", self.transition_bits, 0.0, 1.0)?;
        check_range("ramp_s", self.ramp_s, 0.0, 0.1)?;
        check_range("preamble_chars", f64::from(self.preamble_chars), 0.0, 1000.0)?;
        check_range("postamble_chars", f64::from(self.postamble_chars), 0.0, 1000.0)?;
        check_range("amplitude", f64::from(self.amplitude), 0.0, 1.0)
    }
}

#[derive(Clone, Copy, Debug)]
struct Element {
    mark: bool,
    seconds: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stage {
    Running,
    Finishing,
    RampDown,
    Done,
}

/// Streaming AFSK modulator for keyboard operation: queue text while it renders, send the idle
/// signal when the queue runs dry, and end with [`Modulator::finish`].
#[derive(Clone, Debug)]
pub struct Modulator {
    cfg: TxConfig,
    encoder: TextEncoder,
    queue: VecDeque<Element>,
    current: Element,
    elapsed: f64,
    from_hz: f64,
    phase: f64,
    time: f64,
    stage: Stage,
    codes: Vec<u8>,
}

impl Modulator {
    /// A modulator that starts with a mark lead of one bit (or the ramp, if longer) and the
    /// preamble.
    pub fn new(cfg: TxConfig) -> Result<Self, ConfigError> {
        cfg.check()?;
        let bit = cfg.params.bit_s();
        let mut m = Self {
            cfg,
            encoder: TextEncoder::new(cfg.params.figures, cfg.params.unshift_on_space),
            queue: VecDeque::new(),
            current: Element {
                mark: true,
                seconds: bit.max(cfg.ramp_s),
            },
            elapsed: 0.0,
            from_hz: cfg.mark_hz,
            phase: 0.0,
            time: 0.0,
            stage: Stage::Running,
            codes: Vec::new(),
        };
        for _ in 0..cfg.preamble_chars {
            m.push_code(LTRS);
        }
        if cfg.preamble_chars > 0 {
            m.encoder.set_case(Some(Case::Letters));
        }
        Ok(m)
    }

    fn push_code(&mut self, code: u8) {
        let bit = self.cfg.params.bit_s();
        self.queue.push_back(Element {
            mark: false,
            seconds: bit,
        });
        for i in 0..5 {
            self.queue.push_back(Element {
                mark: (code >> i) & 1 == 1,
                seconds: bit,
            });
        }
        self.queue.push_back(Element {
            mark: true,
            seconds: bit * self.cfg.params.stop_bits,
        });
    }

    /// Queues `text` for sending. Lower case is sent as upper case and a newline as CR LF.
    /// Returns the number of characters skipped because ITA2 has no code for them. Ignored
    /// after [`Modulator::finish`].
    pub fn push_text(&mut self, text: &str) -> usize {
        if self.stage != Stage::Running {
            return 0;
        }
        let mut codes = std::mem::take(&mut self.codes);
        codes.clear();
        let skipped = text
            .chars()
            .filter(|&ch| !self.encoder.push_char(ch, &mut codes))
            .count();
        for &c in &codes {
            self.push_code(c);
        }
        self.codes = codes;
        skipped
    }

    /// Sends the queued text and the postamble, then ramps down and stops.
    pub fn finish(&mut self) {
        if self.stage == Stage::Running {
            for _ in 0..self.cfg.postamble_chars {
                self.push_code(LTRS);
            }
            self.stage = Stage::Finishing;
        }
    }

    /// True once the transmission has ramped down after [`Modulator::finish`].
    pub fn is_done(&self) -> bool {
        self.stage == Stage::Done
    }

    /// Audio still queued, in seconds, including the element being sent.
    pub fn queued_s(&self) -> f64 {
        self.queue.iter().map(|e| e.seconds).sum::<f64>() + (self.current.seconds - self.elapsed).max(0.0)
    }

    fn tone_hz(&self, mark: bool) -> f64 {
        if mark {
            self.cfg.mark_hz
        } else {
            self.cfg.params.space_hz(self.cfg.mark_hz)
        }
    }

    fn idle_element(&mut self, dt: f64) -> Element {
        let bit = self.cfg.params.bit_s();
        let mark_bit = Element {
            mark: true,
            seconds: bit,
        };
        match self.stage {
            Stage::Running => match self.cfg.idle {
                Idle::Diddle => {
                    self.push_code(LTRS);
                    self.encoder.set_case(Some(Case::Letters));
                    self.queue.pop_front().unwrap_or(mark_bit)
                }
                Idle::Mark => mark_bit,
            },
            Stage::Finishing | Stage::RampDown | Stage::Done => {
                self.stage = Stage::RampDown;
                Element {
                    mark: true,
                    seconds: self.cfg.ramp_s.max(dt),
                }
            }
        }
    }

    /// Fills `out` with audio and returns the number of samples written, which is less than
    /// `out.len()` only when the transmission ends.
    pub fn render(&mut self, out: &mut [f32]) -> usize {
        let dt = 1.0 / self.cfg.sample_rate;
        let w = self.cfg.transition_bits * self.cfg.params.bit_s();
        let ramp = self.cfg.ramp_s;
        let amp = f64::from(self.cfg.amplitude);
        for (i, o) in out.iter_mut().enumerate() {
            if self.stage == Stage::Done {
                return i;
            }
            while self.elapsed >= self.current.seconds {
                if self.stage == Stage::RampDown {
                    self.stage = Stage::Done;
                    return i;
                }
                self.elapsed -= self.current.seconds;
                let from = self.tone_hz(self.current.mark);
                self.current = match self.queue.pop_front() {
                    Some(e) => e,
                    None => self.idle_element(dt),
                };
                self.from_hz = from;
            }
            let target = self.tone_hz(self.current.mark);
            let f = if w > 0.0 && self.elapsed < w {
                self.from_hz + (target - self.from_hz) * 0.5 * (1.0 - (PI * self.elapsed / w).cos())
            } else {
                target
            };
            let mut env = if ramp > 0.0 && self.time < ramp {
                0.5 * (1.0 - (PI * self.time / ramp).cos())
            } else {
                1.0
            };
            if self.stage == Stage::RampDown {
                env *= 0.5 * (1.0 + (PI * self.elapsed / self.current.seconds).cos());
            }
            *o = (amp * env * self.phase.sin()) as f32;
            self.phase = (self.phase + TAU * f * dt).rem_euclid(TAU);
            self.elapsed += dt;
            self.time += dt;
        }
        out.len()
    }
}

/// Renders `text` as one transmission: lead, preamble, text, postamble and ramps. Characters
/// without an ITA2 code are skipped.
pub fn encode(text: &str, cfg: &TxConfig) -> Result<Vec<f32>, ConfigError> {
    let mut m = Modulator::new(*cfg)?;
    m.push_text(text);
    m.finish();
    let mut out = Vec::with_capacity((m.queued_s() * cfg.sample_rate) as usize + 64);
    let mut buf = vec![0.0f32; 4096];
    loop {
        let n = m.render(&mut buf);
        out.extend_from_slice(&buf[..n]);
        if n < buf.len() {
            return Ok(out);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn goertzel_power(x: &[f32], f: f64, fs: f64) -> f64 {
        let w = TAU * f / fs;
        let (mut s1, mut s2) = (0.0f64, 0.0f64);
        for &v in x {
            let s = f64::from(v) + 2.0 * w.cos() * s1 - s2;
            s2 = s1;
            s1 = s;
        }
        (s1 * s1 + s2 * s2 - 2.0 * w.cos() * s1 * s2) / (x.len() as f64).powi(2)
    }

    #[test]
    fn length_follows_the_frame_count() {
        let cfg = TxConfig::default();
        let x = encode("RYRY", &cfg).expect("encode");
        // Lead 1 bit, 3 preamble LTRS, 4 letters, 1 postamble LTRS, ramp down.
        let bits = 1.0 + (3.0 + 4.0 + 1.0) * 7.5;
        let expected = bits / 45.45 * 12_000.0 + 60.0;
        assert!((x.len() as f64 - expected).abs() <= 2.0, "{} {expected}", x.len());
        assert!(x.iter().all(|v| v.abs() <= 1.0));
        assert_eq!(x[0], 0.0);
        assert!(x[x.len() - 1].abs() < 0.01);
    }

    #[test]
    fn phase_is_continuous() {
        let cfg = TxConfig {
            transition_bits: 0.0,
            ramp_s: 0.0,
            ..TxConfig::default()
        };
        let x = encode("THE QUICK BROWN FOX 0123", &cfg).expect("encode");
        let step = TAU * 1585.0 / 12_000.0 * 1.0001;
        assert!(x.windows(2).all(|p| f64::from((p[1] - p[0]).abs()) <= step));
    }

    #[test]
    fn diddle_and_mark_idle_fill_the_gap() {
        for idle in [Idle::Diddle, Idle::Mark] {
            let mut m = Modulator::new(TxConfig {
                idle,
                preamble_chars: 0,
                ..TxConfig::default()
            })
            .expect("modulator");
            let mut buf = vec![0.0f32; 24_000];
            assert_eq!(m.render(&mut buf), buf.len());
            let mark = goertzel_power(&buf[1000..], 1585.0, 12_000.0);
            let space = goertzel_power(&buf[1000..], 1415.0, 12_000.0);
            match idle {
                // LTRS is 6 of 7.5 bits mark.
                Idle::Diddle => assert!(space > 0.01 * mark && mark > space, "{mark} {space}"),
                Idle::Mark => assert!(space < 1e-4 * mark, "{mark} {space}"),
            }
            m.finish();
            let mut n = 0;
            while !m.is_done() && n < 100 {
                m.render(&mut buf);
                n += 1;
            }
            assert!(m.is_done());
        }
    }

    #[test]
    fn rejects_bad_settings() {
        let bad = |f: fn(&mut TxConfig)| {
            let mut c = TxConfig::default();
            f(&mut c);
            Modulator::new(c).is_err()
        };
        assert!(bad(|c| c.mark_hz = 20.0));
        assert!(bad(|c| c.sample_rate = 1000.0));
        assert!(bad(|c| c.transition_bits = 2.0));
        assert!(bad(|c| c.amplitude = 1.5));
        assert!(!bad(|c| c.sample_rate = 48_000.0));
    }
}
