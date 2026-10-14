//! Digital silence in slot audio: the zeros the app writes where no audio arrived, such as
//! the part of a slot before capture started or a hole after an interruption.
//!
//! A sample is silent when it lies in a run of at least [`MIN_RUN`] consecutive zero
//! samples. Zero means `0.0` or `-0.0`; non-finite samples count as zero, as the spectrogram
//! reads them. The app's waterfall uses the same rule (`countValid` in
//! `web/src/lib/waterfall/renderer.ts`). Received noise does not hold such runs: quantised
//! to 16 bits at 2 LSB RMS, a sample is zero with probability 0.2, so 32 in a row come with
//! probability below 1e-22.
//!
//! A spectrogram frame is live when no silent sample lies under its window. A frame that
//! overlaps silence reads less power than the audio around it, in proportion to the window
//! energy over the silent samples, so it is left out whole. Samples beyond the ends of the
//! input are not counted as silent: frames at the edges of a slot with audio throughout keep
//! the handling they had before silence was detected.

use rr73_dsp::SpectrogramConfig;

/// Shortest run of zero samples that counts as digital silence, in samples.
pub const MIN_RUN: usize = 32;

/// Marks each of `frames` frames of a spectrogram with `config` over `samples`: `true` when
/// no silent sample lies under the frame's window. `out` is cleared first and holds `frames`
/// values afterwards.
pub fn live_frames(samples: &[f32], config: &SpectrogramConfig, frames: usize, out: &mut Vec<bool>) {
    let mut runs = Vec::new();
    silent_runs(samples, &mut runs);
    live_frames_from_runs(&runs, config, frames, out);
}

/// Finds the silent runs in `samples`, as half-open sample ranges in order. `out` is cleared
/// first. A decoder that subtracts signals from the audio finds the runs once, in its input,
/// since subtraction writes small non-zero values into silent samples a signal spans.
pub fn silent_runs(samples: &[f32], out: &mut Vec<(usize, usize)>) {
    out.clear();
    let mut run_start = None;
    for (i, &x) in samples.iter().enumerate() {
        let zero = x == 0.0 || !x.is_finite();
        match (zero, run_start) {
            (true, None) => run_start = Some(i),
            (false, Some(s)) => {
                if i - s >= MIN_RUN {
                    out.push((s, i));
                }
                run_start = None;
            }
            _ => {}
        }
    }
    if let Some(s) = run_start
        && samples.len() - s >= MIN_RUN
    {
        out.push((s, samples.len()));
    }
}

/// As [`live_frames`], from runs found by [`silent_runs`].
pub fn live_frames_from_runs(
    runs: &[(usize, usize)],
    config: &SpectrogramConfig,
    frames: usize,
    out: &mut Vec<bool>,
) {
    out.clear();
    out.resize(frames, true);
    let hop = config.hop as i64;
    if hop == 0 || frames == 0 {
        return;
    }
    // Frame t covers samples [t * hop + offset, t * hop + offset + window_len).
    let pad = (config.fft_size.saturating_sub(config.window_len) / 2) as i64;
    let offset = pad - (config.fft_size / 2) as i64;
    let window = config.window_len as i64;
    for &(start, end) in runs {
        let (s, e) = (start as i64, end as i64);
        // Frames whose window ends after s and starts before e.
        let first = (s - offset - window).div_euclid(hop) + 1;
        let last = -(-(e - offset)).div_euclid(hop) - 1;
        let first = first.max(0);
        let last = last.min(frames as i64 - 1);
        if first <= last {
            out[first as usize..=last as usize].fill(false);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> SpectrogramConfig {
        // Baseline FT8: hop 960, FFT and Hann window of 3840 samples.
        SpectrogramConfig::oversampled(1920, 2, 2, 200.0, 3000.0, 12_000).expect("config")
    }

    fn live(samples: &[f32]) -> Vec<bool> {
        let c = config();
        let mut out = Vec::new();
        live_frames(samples, &c, c.frames_for(samples.len()), &mut out);
        out
    }

    #[test]
    fn audio_throughout_leaves_every_frame_live() {
        let samples = vec![0.01f32; 180_000];
        let out = live(&samples);
        assert_eq!(out.len(), 188);
        assert!(out.iter().all(|&l| l));
        assert!(live(&[]).is_empty());
    }

    #[test]
    fn runs_shorter_than_the_minimum_are_audio() {
        let mut samples = vec![0.01f32; 180_000];
        samples[50_000..50_000 + MIN_RUN - 1].fill(0.0);
        samples[90_000] = f32::NAN;
        assert!(live(&samples).iter().all(|&l| l));
    }

    #[test]
    fn frames_touching_a_silent_run_are_marked() {
        // Samples 10_000 to 10_031 silent. Frame t covers [960 t - 1920, 960 t + 1920):
        // frame 8 ends at 9600, before the run; frame 13 starts at 10_560, after it.
        let mut samples = vec![0.01f32; 180_000];
        samples[10_000..10_000 + MIN_RUN].fill(0.0);
        let out = live(&samples);
        let dead: Vec<usize> = (0..out.len()).filter(|&t| !out[t]).collect();
        assert_eq!(dead, vec![9, 10, 11, 12]);
    }

    #[test]
    fn a_silent_start_marks_the_frames_it_reaches() {
        // The first 2 s silent: frame t is live once its window starts at or after 24_000,
        // that is 960 t - 1920 >= 24_000, t >= 27.
        let mut samples = vec![0.01f32; 180_000];
        samples[..24_000].fill(0.0);
        samples[1000] = f32::INFINITY;
        let out = live(&samples);
        assert!(out[..27].iter().all(|&l| !l));
        assert!(out[27..].iter().all(|&l| l));
        let silent = vec![0.0f32; 180_000];
        assert!(live(&silent).iter().all(|&l| !l));
    }
}
