//! Streaming RTTY decoder: audio in, characters and status events out.

use serde::{Deserialize, Serialize};

use crate::SAMPLE_RATE;
use crate::config::{ConfigError, DEFAULT_MARK_HZ, RttyParams, STANDARD_SHIFTS_HZ, check_range, check_tone};
use crate::demod::{Demod, Design, Frontend, design};
use crate::framer::{AnyFramer, Frame, Uart, Viterbi};
use crate::ita2::{Case, Decoded, TextDecoder};
use crate::spectrum::Spectrum;

/// How characters are framed.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Framer {
    /// Dynamic programming over start-bit positions, with a delay of `latency_chars`.
    #[default]
    Viterbi,
    /// Edge hunting as in a hardware UART, with a delay of one character.
    Uart,
}

/// What happens to a character whose start bit reads as mark or stop bit as space.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FramingErrors {
    /// Print it, with `framing_error` set on the event.
    #[default]
    Print,
    /// Drop it. LTRS and FIGS with framing errors are dropped too.
    Drop,
}

/// Automatic frequency control.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AfcConfig {
    /// Follow the pair's frequency as it drifts.
    pub track: bool,
    /// At start, search for the strongest pair whose centre lies within this distance of the
    /// configured pair's centre, in Hz. 0 starts on the configured tones.
    pub search_hz: f64,
    /// Let a search pick any standard shift (170, 200, 425 or 850 Hz).
    pub auto_shift: bool,
    /// Tracking holds still while the SNR is below this, in dB in 3000 Hz.
    pub min_snr_db: f64,
    /// Time constant of tracking, in bits.
    pub time_constant_bits: f64,
}

impl Default for AfcConfig {
    fn default() -> Self {
        Self {
            track: true,
            search_hz: 0.0,
            auto_shift: false,
            min_snr_db: -16.0,
            time_constant_bits: 16.0,
        }
    }
}

/// Decoder settings.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct DecoderConfig {
    /// Line code and keying to expect.
    pub params: RttyParams,
    /// Mark tone to start on, in Hz.
    pub mark_hz: f64,
    /// Automatic frequency control.
    pub afc: AfcConfig,
    /// Squelch threshold, in dB SNR in 3000 Hz; characters print only above it. `None` prints
    /// everything.
    pub squelch_db: Option<f64>,
    /// How characters are framed.
    pub framer: Framer,
    /// What happens to characters with framing errors.
    pub framing_errors: FramingErrors,
    /// Time constant of the threshold correction's tone levels, in bits.
    pub atc_bits: f64,
    /// Shortest stop element the framer accepts, in bits (1 to 2). 1 accepts every sender.
    pub min_stop_bits: f64,
    /// Output delay of the Viterbi framer, in characters.
    pub latency_chars: f64,
    /// Matched filter length, in bits.
    pub filter_bits: f64,
}

impl Default for DecoderConfig {
    fn default() -> Self {
        Self {
            params: RttyParams::default(),
            mark_hz: DEFAULT_MARK_HZ,
            afc: AfcConfig::default(),
            squelch_db: None,
            framer: Framer::Viterbi,
            framing_errors: FramingErrors::Print,
            atc_bits: 4.0,
            min_stop_bits: 1.0,
            latency_chars: 2.0,
            filter_bits: 1.0,
        }
    }
}

impl DecoderConfig {
    /// Checks every field against the supported ranges.
    pub fn check(&self) -> Result<(), ConfigError> {
        self.params.check()?;
        check_tone(self.mark_hz)?;
        check_tone(self.params.space_hz(self.mark_hz))?;
        check_range("afc.search_hz", self.afc.search_hz, 0.0, 3000.0)?;
        check_range("afc.min_snr_db", self.afc.min_snr_db, -60.0, 60.0)?;
        check_range(
            "afc.time_constant_bits",
            self.afc.time_constant_bits,
            1.0,
            10_000.0,
        )?;
        if let Some(s) = self.squelch_db {
            check_range("squelch_db", s, -60.0, 60.0)?;
        }
        check_range("atc_bits", self.atc_bits, 0.5, 1000.0)?;
        check_range("min_stop_bits", self.min_stop_bits, 1.0, 2.0)?;
        check_range("latency_chars", self.latency_chars, 0.5, 20.0)?;
        check_range("filter_bits", self.filter_bits, 0.5, 1.5)
    }
}

/// What the decoder reports. `sample` counts input samples at 12 kHz from the decoder's
/// creation or last reset.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RttyEvent {
    /// A received character. CR is `\r`, LF `\n`, BELL U+0007 and WRU U+0005.
    Char {
        /// The character.
        ch: char,
        /// Start-bit edge.
        sample: u64,
        /// SNR when the character was framed, in dB in 3000 Hz.
        snr_db: f32,
        /// Bit confidence from 0 to 1: 1 minus twice the mean bit error probability.
        quality: f32,
        /// The start bit read as mark or the stop bit as space.
        framing_error: bool,
    },
    /// The receiver changed between letters and figures case (LTRS, FIGS or unshift on space).
    Case {
        /// Start-bit edge of the character that changed it.
        sample: u64,
        /// The new case.
        case: Case,
    },
    /// The AFC moved the pair or a search found one.
    Afc {
        /// When it moved.
        sample: u64,
        /// Mark tone, in Hz.
        mark_hz: f64,
        /// Space tone, in Hz.
        space_hz: f64,
    },
    /// A search found a pair with another shift.
    ToneShift {
        /// When it was found.
        sample: u64,
        /// The new shift, in Hz.
        shift_hz: f64,
    },
    /// Signal report, every 0.51 s and whenever the squelch opens or closes.
    Signal {
        /// When it was measured.
        sample: u64,
        /// SNR of the pair, in dB in 3000 Hz.
        snr_db: f32,
        /// Characters print.
        squelch_open: bool,
    },
}

/// Streaming RTTY decoder. Push 12 kHz audio in blocks of any size; events come back in
/// order. The same audio gives the same events whatever the block sizes.
#[derive(Clone, Debug)]
pub struct RttyDecoder {
    cfg: DecoderConfig,
    params: RttyParams,
    center_hz: f64,
    design: Design,
    frontend: Frontend,
    demod: Demod,
    framer: AnyFramer,
    text: TextDecoder,
    spectrum: Spectrum,
    samples: u64,
    origin: u64,
    afc_count: usize,
    afc_period: usize,
    snr_db: f64,
    squelch_open: bool,
    hops: u32,
    pending_find: Option<(f64, f64)>,
    reported_mark_hz: f64,
    frames: Vec<Frame>,
}

impl RttyDecoder {
    /// A decoder on the configured tones. With `afc.search_hz` above 0 it first searches for
    /// the strongest pair nearby, after 1 s of audio.
    pub fn new(config: DecoderConfig) -> Result<Self, ConfigError> {
        config.check()?;
        let params = config.params;
        let center_hz = params.center_hz(config.mark_hz);
        let design = design(&params);
        let mut d = Self {
            frontend: Frontend::new(&design, center_hz),
            demod: Demod::new(&design, &params, config.atc_bits, config.filter_bits),
            framer: Self::new_framer(&config, design.sps),
            text: TextDecoder::new(params.figures, params.unshift_on_space),
            spectrum: Spectrum::new(),
            afc_period: design.sps.round() as usize,
            design,
            cfg: config,
            params,
            center_hz,
            samples: 0,
            origin: 0,
            afc_count: 0,
            snr_db: -40.0,
            squelch_open: config.squelch_db.is_none(),
            hops: 0,
            pending_find: None,
            reported_mark_hz: config.mark_hz,
            frames: Vec::new(),
        };
        if config.afc.search_hz > 0.0 {
            d.pending_find = Some((center_hz, config.afc.search_hz));
        }
        Ok(d)
    }

    fn new_framer(cfg: &DecoderConfig, sps: f64) -> AnyFramer {
        match cfg.framer {
            Framer::Viterbi => {
                AnyFramer::Viterbi(Box::new(Viterbi::new(sps, cfg.min_stop_bits, cfg.latency_chars)))
            }
            Framer::Uart => AnyFramer::Uart(Uart::new(sps)),
        }
    }

    /// Rebuilds the signal path for the current centre and shift; keeps the spectrum.
    fn rebuild(&mut self) {
        self.design = design(&self.params);
        self.frontend = Frontend::new(&self.design, self.center_hz);
        self.demod = Demod::new(
            &self.design,
            &self.params,
            self.cfg.atc_bits,
            self.cfg.filter_bits,
        );
        self.framer = Self::new_framer(&self.cfg, self.design.sps);
        self.afc_period = self.design.sps.round() as usize;
        self.afc_count = 0;
        self.text.reset();
        self.origin = self.samples;
        self.frames.clear();
    }

    /// The settings the decoder was created with.
    pub fn config(&self) -> &DecoderConfig {
        &self.cfg
    }

    /// Mark tone now, in Hz.
    pub fn mark_hz(&self) -> f64 {
        self.params.mark_for_center(self.center_hz)
    }

    /// Space tone now, in Hz.
    pub fn space_hz(&self) -> f64 {
        self.params.space_hz(self.mark_hz())
    }

    /// Shift now, in Hz.
    pub fn shift_hz(&self) -> f64 {
        self.params.shift_hz
    }

    /// Latest SNR of the pair, in dB in 3000 Hz.
    pub fn snr_db(&self) -> f64 {
        self.snr_db
    }

    /// Input samples taken since creation or the last reset.
    pub fn samples(&self) -> u64 {
        self.samples
    }

    /// Moves to the pair with mark at `mark_hz` (for example a tap on the waterfall's mark
    /// line) and restarts framing. Cancels a pending search. Out-of-range tones are ignored.
    pub fn tune(&mut self, mark_hz: f64) {
        let space = self.params.space_hz(mark_hz);
        if check_tone(mark_hz).is_err() || check_tone(space).is_err() {
            return;
        }
        self.pending_find = None;
        self.center_hz = self.params.center_hz(mark_hz);
        self.reported_mark_hz = mark_hz;
        self.rebuild();
    }

    /// Searches the last second or so of audio for the strongest pair whose centre lies within
    /// `range_hz` of `near_hz` (for a tap on the waterfall, the tapped frequency and about one
    /// shift). The search runs at the next spectrum, within 0.17 s of audio, and reports an
    /// `Afc` event when it finds a pair; without one the decoder stays where it is.
    pub fn find(&mut self, near_hz: f64, range_hz: f64) {
        if near_hz.is_finite() && range_hz.is_finite() {
            self.pending_find = Some((near_hz, range_hz.clamp(0.0, 3000.0)));
        }
    }

    /// Turns frequency tracking on or off.
    pub fn set_afc_tracking(&mut self, on: bool) {
        self.cfg.afc.track = on;
    }

    /// Clears all state and the sample count. Keeps the current tones.
    pub fn reset(&mut self) {
        self.samples = 0;
        self.spectrum.reset();
        self.snr_db = -40.0;
        self.squelch_open = self.cfg.squelch_db.is_none();
        self.hops = 0;
        self.rebuild();
    }

    /// Decodes a block of mono 12 kHz audio. Non-finite samples count as 0.
    pub fn push(&mut self, samples: &[f32]) -> Vec<RttyEvent> {
        let mut events = Vec::new();
        for &x in samples {
            let x = if x.is_finite() { x } else { 0.0 };
            self.samples += 1;
            if self.spectrum.push(x) {
                self.on_spectrum(&mut events);
            }
            if let Some(y) = self.frontend.push(x) {
                let soft = self.demod.push(y);
                self.framer.push(soft, &mut self.frames);
                self.afc_count += 1;
                if self.afc_count >= self.afc_period {
                    self.afc_count = 0;
                    self.track(&mut events);
                }
                if !self.frames.is_empty() {
                    self.emit_frames(&mut events);
                }
            }
        }
        events
    }

    /// Emits the characters the Viterbi framer still holds for its output delay, for the end
    /// of a recording. Decoding can continue afterwards.
    pub fn flush(&mut self) -> Vec<RttyEvent> {
        let mut events = Vec::new();
        self.framer.flush(&mut self.frames);
        self.emit_frames(&mut events);
        events
    }

    fn on_spectrum(&mut self, events: &mut Vec<RttyEvent>) {
        self.hops += 1;
        self.snr_db = self
            .spectrum
            .snr_db(self.mark_hz(), self.space_hz(), self.params.baud);
        let was = self.squelch_open;
        if let Some(th) = self.cfg.squelch_db {
            self.squelch_open = if was {
                self.snr_db >= th - 2.0
            } else {
                self.snr_db >= th
            };
        }
        if self.hops.is_multiple_of(3) || was != self.squelch_open {
            events.push(RttyEvent::Signal {
                sample: self.samples,
                snr_db: self.snr_db as f32,
                squelch_open: self.squelch_open,
            });
        }
        // Wait for about 1 s of audio (5 spectra) before a search.
        if self.spectrum.frames() >= 5
            && let Some((near, range)) = self.pending_find.take()
        {
            self.search(near, range, events);
        }
    }

    fn search(&mut self, near_hz: f64, range_hz: f64, events: &mut Vec<RttyEvent>) {
        let shifts: Vec<f64> = if self.cfg.afc.auto_shift {
            STANDARD_SHIFTS_HZ.to_vec()
        } else {
            vec![self.params.shift_hz]
        };
        let Some((center, shift)) =
            self.spectrum
                .find_pair(near_hz, range_hz, &shifts, self.params.shift_hz, self.params.baud)
        else {
            return;
        };
        let changed = (shift - self.params.shift_hz).abs() > 0.5;
        let mut params = self.params;
        params.shift_hz = shift;
        let mark = params.mark_for_center(center);
        if check_tone(mark).is_err() || check_tone(params.space_hz(mark)).is_err() {
            return;
        }
        self.params = params;
        self.center_hz = center;
        self.rebuild();
        if changed {
            events.push(RttyEvent::ToneShift {
                sample: self.samples,
                shift_hz: shift,
            });
        }
        self.report_afc(events);
    }

    fn report_afc(&mut self, events: &mut Vec<RttyEvent>) {
        self.reported_mark_hz = self.mark_hz();
        events.push(RttyEvent::Afc {
            sample: self.samples,
            mark_hz: self.mark_hz(),
            space_hz: self.space_hz(),
        });
    }

    fn track(&mut self, events: &mut Vec<RttyEvent>) {
        let err = self.demod.take_afc();
        if !self.cfg.afc.track || self.snr_db < self.cfg.afc.min_snr_db {
            return;
        }
        let Some(err) = err else { return };
        let limit = 0.1 * self.params.baud;
        let step = (err / self.cfg.afc.time_constant_bits).clamp(-limit, limit);
        let mark = self.params.mark_for_center(self.center_hz + step);
        if check_tone(mark).is_err() || check_tone(self.params.space_hz(mark)).is_err() {
            return;
        }
        self.center_hz += step;
        self.frontend.set_center(self.center_hz);
        if (self.mark_hz() - self.reported_mark_hz).abs() >= 1.0 {
            self.report_afc(events);
        }
    }

    /// Input sample of a frame's start edge: the decimated position maps back through the
    /// decimation and the low-pass filter's delay.
    fn frame_sample(&self, start: f64) -> u64 {
        let s = (start + 1.5) * self.design.decim as f64 - 1.0 - self.design.delay;
        self.origin + s.max(0.0).round() as u64
    }

    fn emit_frames(&mut self, events: &mut Vec<RttyEvent>) {
        let frames = std::mem::take(&mut self.frames);
        for f in &frames {
            if f.framing_error && self.cfg.framing_errors == FramingErrors::Drop {
                continue;
            }
            let sample = self.frame_sample(f.start);
            let before = self.text.case();
            let decoded = self.text.push(f.code);
            if !self.squelch_open {
                continue;
            }
            if let Decoded::Char(ch) = decoded {
                events.push(RttyEvent::Char {
                    ch,
                    sample,
                    snr_db: self.snr_db as f32,
                    quality: f.quality,
                    framing_error: f.framing_error,
                });
            }
            if self.text.case() != before {
                events.push(RttyEvent::Case {
                    sample,
                    case: self.text.case(),
                });
            }
        }
        self.frames = frames;
        self.frames.clear();
    }
}

/// Seconds of audio for `samples` at 12 kHz.
pub fn samples_to_s(samples: u64) -> f64 {
    samples as f64 / SAMPLE_RATE
}
