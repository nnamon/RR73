//! Message checks after sequential decoding. WSPR has no CRC: a decoded path is accepted when
//! its 50 bits unpack to a message whose fields are all ones the protocol produces, its
//! callsign is laid out as a standard callsign, and its re-encoded symbols agree with what was
//! received.

use rr73_wspr::code::{self, INPUT_BITS};
use rr73_wspr::message::pack_call;
use rr73_wspr::{CallsignHashes, Message, Packed, SYMBOLS, unpack};

use super::demod::SoftSymbols;
use super::refine::TonePowers;

/// SNR in 2500 Hz from the power ratio of one tone correlation, in dB: the correlation
/// integrates one symbol (0.683 s), so its noise bandwidth is 1.4648 Hz and the conversion is
/// `-10 log10(2500 / 1.4648)`.
pub const SNR_OFFSET_DB: f32 = -32.321_6;

/// A message that passed the checks.
#[derive(Clone, Debug, PartialEq)]
pub struct Validated {
    /// The message.
    pub message: Message,
    /// The packed fields.
    pub packed: Packed,
    /// The 162 channel symbols of the message.
    pub symbols: [u8; SYMBOLS],
    /// Data bits on which the re-encoded message disagrees with the hard decisions.
    pub hard_errors: u32,
    /// Estimated SNR in 2500 Hz, in dB.
    pub snr_db: f32,
}

/// Why a decoded path was rejected.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WsprRejection {
    /// The fields do not unpack.
    Unpack,
    /// The callsign is not laid out as a standard callsign.
    Implausible,
    /// Too many data bits disagree with the hard decisions, or the SNR is below the floor.
    Weak,
}

/// Checks decoded paths.
pub trait WsprValidator {
    /// Short name used in reports.
    fn name(&self) -> &'static str;

    /// Checks the 81 decoded input bits against the received powers.
    fn validate(
        &self,
        bits: &[u8; INPUT_BITS],
        powers: &TonePowers,
        soft: &SoftSymbols,
        hashes: &CallsignHashes,
    ) -> Result<Validated, WsprRejection>;
}

/// Unpack, plausibility and re-encoding checks.
#[derive(Clone, Debug, PartialEq)]
pub struct UnpackValidator {
    /// Most disagreeing data bits.
    pub max_hard_errors: u32,
    /// Lowest SNR, in dB.
    pub min_snr_db: f32,
}

/// `true` when the callsign field holds `call` laid out as a standard callsign: it packs back
/// to the same field (digit in position 2 or 3, 1 to 3 letters after it, a letter before it).
pub fn plausible_call(call: &str, field: u32) -> bool {
    pack_call(call) == Ok(field)
}

/// Estimated SNR in 2500 Hz of a signal sending `symbols`, from the tone powers and the noise
/// power per correlation, in dB. Floored at -60 dB.
pub fn snr_db(powers: &TonePowers, symbols: &[u8; SYMBOLS], noise: f32) -> f32 {
    let on: f32 = powers
        .iter()
        .zip(symbols.iter())
        .map(|(p, &s)| p[usize::from(s & 3)])
        .sum::<f32>()
        / SYMBOLS as f32;
    let ratio = ((on - noise) / noise.max(f32::MIN_POSITIVE)).max(1e-6);
    (10.0 * ratio.log10() + SNR_OFFSET_DB).max(-60.0)
}

impl WsprValidator for UnpackValidator {
    fn name(&self) -> &'static str {
        "unpack"
    }

    fn validate(
        &self,
        bits: &[u8; INPUT_BITS],
        powers: &TonePowers,
        soft: &SoftSymbols,
        hashes: &CallsignHashes,
    ) -> Result<Validated, WsprRejection> {
        let packed = Packed::from_bits(&bits[..code::MESSAGE_BITS]);
        let message = unpack(&packed, hashes).map_err(|_| WsprRejection::Unpack)?;
        let plausible = match &message {
            Message::Standard { call, .. } => plausible_call(call, packed.call_field),
            Message::Compound { call, .. } => call
                .split('/')
                .any(|part| plausible_call(part, packed.call_field)),
            Message::Hashed { .. } => true,
        };
        if !plausible {
            return Err(WsprRejection::Implausible);
        }
        let symbols = code::symbols(&packed);
        let hard_errors = powers
            .iter()
            .zip(symbols.iter())
            .filter(|(p, s)| {
                let sync = usize::from(**s & 1);
                let sent = **s >> 1;
                let decided = u8::from(p[sync + 2] > p[sync]);
                sent != decided
            })
            .count() as u32;
        let snr = snr_db(powers, &symbols, soft.noise);
        if hard_errors > self.max_hard_errors || snr < self.min_snr_db {
            return Err(WsprRejection::Weak);
        }
        Ok(Validated {
            message,
            packed,
            symbols,
            hard_errors,
            snr_db: snr,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plausible_calls_repack_to_their_field() {
        let field = pack_call("K1ABC").expect("pack");
        assert!(plausible_call("K1ABC", field));
        assert!(!plausible_call("K1ABD", field));
        // ` K1A C`: a letter after a space does not repack.
        let odd_field = field + 25 * 27;
        let odd = rr73_wspr::message::unpack_call(odd_field).expect("unpack");
        assert_eq!(odd, "K1A C");
        assert!(!plausible_call(&odd, odd_field));
    }

    #[test]
    fn snr_reads_the_power_ratio() {
        // Signal tone at 1 + 1706.7 x 10^(-25/10) times the noise: -25 dB.
        let ratio = 10f32.powf(-SNR_OFFSET_DB / 10.0) * 10f32.powf(-2.5);
        let symbols = [1u8; SYMBOLS];
        let mut p = [[1.0f32; 4]; SYMBOLS];
        for row in p.iter_mut() {
            row[1] = 1.0 + ratio;
        }
        assert!((snr_db(&p, &symbols, 1.0) + 25.0).abs() < 0.01);
    }
}
