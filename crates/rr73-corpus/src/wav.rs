//! 16-bit mono PCM WAV reading and writing.

use std::path::Path;

use crate::CorpusError;

/// Reads a mono 16-bit PCM WAV and returns its samples scaled to [-1, 1) and its sample
/// rate in Hz. Other sample formats and channel counts are rejected.
pub fn read(path: &Path) -> Result<(Vec<f32>, u32), CorpusError> {
    let wav_err = |source| CorpusError::Wav {
        path: path.display().to_string(),
        source,
    };
    let reader = hound::WavReader::open(path).map_err(wav_err)?;
    let spec = reader.spec();
    if spec.channels != 1 || spec.bits_per_sample != 16 || spec.sample_format != hound::SampleFormat::Int {
        return Err(CorpusError::format(
            path,
            format!(
                "expected mono 16-bit PCM, found {} channel(s), {} bit {:?}",
                spec.channels, spec.bits_per_sample, spec.sample_format
            ),
        ));
    }
    let samples = reader
        .into_samples::<i16>()
        .map(|s| s.map(|v| f32::from(v) / 32_768.0))
        .collect::<Result<Vec<f32>, _>>()
        .map_err(wav_err)?;
    Ok((samples, spec.sample_rate))
}

/// Converts a sample in [-1, 1] to 16-bit PCM, rounding and clipping. Non-finite values
/// become 0.
pub fn to_i16(x: f32) -> i16 {
    if !x.is_finite() {
        return 0;
    }
    (x * 32_767.0).round().clamp(-32_768.0, 32_767.0) as i16
}

/// Writes `samples` (nominally in [-1, 1]) as a mono 16-bit PCM WAV at `sample_rate` Hz.
/// Values outside the range clip.
pub fn write(path: &Path, samples: &[f32], sample_rate: u32) -> Result<(), CorpusError> {
    let wav_err = |source| CorpusError::Wav {
        path: path.display().to_string(),
        source,
    };
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec).map_err(wav_err)?;
    {
        let mut w16 = writer.get_i16_writer(samples.len() as u32);
        for &x in samples {
            w16.write_sample(to_i16(x));
        }
        w16.flush().map_err(wav_err)?;
    }
    writer.finalize().map_err(wav_err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conversion_rounds_clips_and_cleans() {
        assert_eq!(to_i16(0.0), 0);
        assert_eq!(to_i16(1.0), 32_767);
        assert_eq!(to_i16(-1.0), -32_767);
        assert_eq!(to_i16(2.0), 32_767);
        assert_eq!(to_i16(-2.0), -32_768);
        assert_eq!(to_i16(f32::NAN), 0);
        assert_eq!(to_i16(f32::INFINITY), 0);
        assert_eq!(to_i16(0.5 / 32_767.0), 1);
    }
}
