//! Bit layouts of the 77-bit message types (QEX, Table 1 and Appendix A).
//!
//! Fields are written left to right in the order of QEX Table 1, followed by n3 (type 0
//! only) and i3.

use super::bits::{BitReader, BitWriter};
use super::callsign::{C28, MAX22, NTOKENS, Suffix, pack_base, pack58, unpack58};
use super::fields::{
    ArrlSection, Exchange, FieldDayClass, FreeText, Grid, Grid6, Reply, Report, RoundupExchange,
    SignalStrength, Telemetry,
};
use super::{Addressee, Field, HashedCallsign, Message, PackError, Station, UnpackError};
use crate::hash::{CallHash, HashWidth};
use crate::{CallsignHashes, Payload};

/// g15 values: 0 to 32 399 are locators, then blank, RRR, RR73, 73 and reports.
const G15_BLANK: u32 = 32_401;
const G15_RRR: u32 = 32_402;
const G15_RR73: u32 = 32_403;
const G15_73: u32 = 32_404;
/// The locator RR73, which also means the word RR73. Every RR73 in the on-air recordings of
/// `fixtures/ft8/onair.json` (66 of 66) uses this value; the public description and ft8_lib
/// use [`G15_RR73`]. Packing writes this value and unpacking accepts both.
const G15_RR73_AS_GRID: u32 = 32_373;
/// g15 value of a 0 dB report. Reports are `32 435 + dB`, from −30 dB (32 405) up.
const G15_REPORT_ZERO: i32 = 32_435;
/// Highest serial number of the EU VHF contest message (11 bits).
pub(crate) const EU_VHF_MAX_SERIAL: u16 = 2047;

/// Packs a message without touching a hash table.
pub(crate) fn encode(m: &Message) -> Result<Payload, PackError> {
    let mut w = BitWriter::new();
    match m {
        Message::FreeText { text } => {
            w.put(text.f71(), 71);
            w.put(0, 3);
            w.put(0, 3);
        }
        Message::Dxpedition {
            rr73_to,
            report_to,
            fox,
            report,
        } => {
            let db = report.db();
            if db > 32 || db % 2 != 0 {
                return Err(PackError::DxpeditionReport(db));
            }
            w.put(c28_station(rr73_to)?.into(), 28);
            w.put(c28_station(report_to)?.into(), 28);
            w.put(hash(fox, HashWidth::Bits10)?.into(), 10);
            w.put(((db + 30) / 2) as u128, 5);
            w.put(1, 3);
            w.put(0, 3);
        }
        Message::FieldDay {
            to,
            de,
            ack,
            transmitters,
            class,
            section,
        } => {
            let (n3, n4) = match transmitters {
                1..=16 => (3, transmitters - 1),
                17..=32 => (4, transmitters - 17),
                _ => return Err(PackError::Transmitters(*transmitters)),
            };
            w.put(c28_station(to)?.into(), 28);
            w.put(c28_station(de)?.into(), 28);
            w.put((*ack).into(), 1);
            w.put(n4.into(), 4);
            w.put(class.code().into(), 3);
            w.put(section.code().into(), 7);
            w.put(n3, 3);
            w.put(0, 3);
        }
        Message::Telemetry { data } => {
            w.put(data.value(), 71);
            w.put(5, 3);
            w.put(0, 3);
        }
        Message::Standard { to, de, exchange } => {
            let (a, flag_a, suffix_a) = match to {
                Addressee::Cq { modifier } => (C28::Cq(*modifier).encode(), false, None),
                Addressee::Qrz => (C28::Qrz.encode(), false, None),
                Addressee::De => (C28::De.encode(), false, None),
                Addressee::Station(s) => c28_flagged(s)?,
            };
            let (b, flag_b, suffix_b) = c28_flagged(de)?;
            let i3 = match (suffix_a, suffix_b) {
                (Some(Suffix::Rover), Some(Suffix::Portable))
                | (Some(Suffix::Portable), Some(Suffix::Rover)) => {
                    return Err(PackError::MixedSuffixes);
                }
                (Some(Suffix::Portable), _) | (_, Some(Suffix::Portable)) => 2,
                _ => 1,
            };
            let (ack, g15) = g15(exchange);
            w.put(a.into(), 28);
            w.put(flag_a.into(), 1);
            w.put(b.into(), 28);
            w.put(flag_b.into(), 1);
            w.put(ack.into(), 1);
            w.put(g15.into(), 15);
            w.put(i3, 3);
        }
        Message::RttyRoundup {
            tu,
            to,
            de,
            ack,
            report,
            exchange,
        } => {
            if let RoundupExchange::Serial(n) = exchange
                && *n > RoundupExchange::MAX_SERIAL
            {
                return Err(PackError::SerialOutOfRange {
                    serial: *n,
                    max: RoundupExchange::MAX_SERIAL,
                });
            }
            w.put((*tu).into(), 1);
            w.put(c28_station(to)?.into(), 28);
            w.put(c28_station(de)?.into(), 28);
            w.put((*ack).into(), 1);
            w.put((report.digit() - 2).into(), 3);
            w.put(exchange.s13().into(), 13);
            w.put(3, 3);
        }
        Message::NonStandardCq { call } => {
            // QEX: h12 is ignored when c1 = 1. Every type 4 CQ in the on-air recordings carries
            // the 12-bit hash of the callsign itself.
            w.put(CallHash::of(call, HashWidth::Bits12).value().into(), 12);
            w.put(pack58(call).into(), 58);
            w.put(0, 1);
            w.put(0, 2);
            w.put(1, 1);
            w.put(4, 3);
        }
        Message::NonStandard {
            call,
            hashed,
            hashed_second,
            reply,
        } => {
            w.put(hash(hashed, HashWidth::Bits12)?.into(), 12);
            w.put(pack58(call).into(), 58);
            w.put((*hashed_second).into(), 1);
            w.put(Reply::code(*reply).into(), 2);
            w.put(0, 1);
            w.put(4, 3);
        }
        Message::EuVhf {
            to,
            de,
            ack,
            report,
            serial,
            grid,
        } => {
            if *serial > EU_VHF_MAX_SERIAL {
                return Err(PackError::SerialOutOfRange {
                    serial: *serial,
                    max: EU_VHF_MAX_SERIAL,
                });
            }
            w.put(hash(to, HashWidth::Bits12)?.into(), 12);
            w.put(hash(de, HashWidth::Bits22)?.into(), 22);
            w.put((*ack).into(), 1);
            w.put((report.digit() - 2).into(), 3);
            w.put((*serial).into(), 11);
            w.put(grid.index().into(), 25);
            w.put(5, 3);
        }
    }
    Ok(w.finish())
}

/// The hash value of a hashed callsign at the width of its field.
fn hash(h: &HashedCallsign, width: HashWidth) -> Result<u32, PackError> {
    h.hash(width).map(|h| h.value()).ok_or(PackError::HashWidth {
        field_bits: width.bits(),
        hash_bits: match h {
            HashedCallsign::Unknown(u) => u.width().bits(),
            HashedCallsign::Known(_) => width.bits(),
        },
    })
}

/// c28 for a field without a suffix flag.
fn c28_station(s: &Station) -> Result<u32, PackError> {
    match s {
        Station::Call(call) => match pack_base(call.as_str()) {
            Some(index) => Ok(C28::Base { call: *call, index }.encode()),
            None => Err(PackError::NotStandardCallsign(*call)),
        },
        Station::Hashed(h) => Ok(NTOKENS + hash(h, HashWidth::Bits22)?),
    }
}

/// c28 and the /R or /P flag for message types 1 and 2.
fn c28_flagged(s: &Station) -> Result<(u32, bool, Option<Suffix>), PackError> {
    match s {
        Station::Call(call) => {
            let (base, suffix) = call.split_suffix();
            match pack_base(base) {
                Some(n) => Ok((NTOKENS + MAX22 + n, suffix.is_some(), suffix)),
                None => Err(PackError::NotStandardCallsign(*call)),
            }
        }
        Station::Hashed(h) => Ok((NTOKENS + hash(h, HashWidth::Bits22)?, false, None)),
    }
}

/// R1 flag and g15 value of the last word of a standard message.
fn g15(exchange: &Exchange) -> (bool, u32) {
    match exchange {
        Exchange::Blank => (false, G15_BLANK),
        Exchange::Rrr => (false, G15_RRR),
        Exchange::Rr73 => (false, G15_RR73_AS_GRID),
        Exchange::SeventyThree => (false, G15_73),
        Exchange::Grid { grid, ack } => (*ack, grid.index().into()),
        Exchange::Report { report, ack } => (*ack, (G15_REPORT_ZERO + i32::from(report.db())) as u32),
    }
}

/// Unpacks a payload. Bits 77 to 79 are ignored.
pub(crate) fn decode(payload: &Payload, hashes: &CallsignHashes) -> Result<Message, UnpackError> {
    let payload = payload.masked();
    let (i3, n3) = (payload.i3(), payload.n3());
    let mut r = BitReader::new(&payload);
    let invalid = |field| UnpackError::InvalidField(field);
    let resolve = |value: u32, width: HashWidth| {
        let h = CallHash::from_field(value, width);
        hashes
            .resolve(h)
            .map_or(HashedCallsign::Unknown(h), HashedCallsign::Known)
    };
    let station = |value: u32| match C28::decode(value) {
        Some(C28::Base { call, .. }) => Ok(Station::Call(call)),
        Some(C28::Hash(h)) => Ok(Station::Hashed(resolve(h, HashWidth::Bits22))),
        _ => Err(invalid(Field::Callsign)),
    };

    match (i3, n3) {
        (0, 0) => {
            let text = FreeText::from_f71(r.take(71)).ok_or(invalid(Field::FreeText))?;
            Ok(Message::FreeText { text })
        }
        (0, 1) => {
            let rr73_to = station(r.take_u32(28))?;
            let report_to = station(r.take_u32(28))?;
            let fox = resolve(r.take_u32(10), HashWidth::Bits10);
            let db = r.take_u32(5) as i32 * 2 - 30;
            let report = Report::new(db).map_err(|_| invalid(Field::Report))?;
            Ok(Message::Dxpedition {
                rr73_to,
                report_to,
                fox,
                report,
            })
        }
        (0, 3) | (0, 4) => {
            let to = station(r.take_u32(28))?;
            let de = station(r.take_u32(28))?;
            let ack = r.flag();
            let n4 = r.take_u32(4) as u8;
            let transmitters = if n3 == 3 { n4 + 1 } else { n4 + 17 };
            let class = FieldDayClass::from_code(r.take_u32(3) as u8).ok_or(invalid(Field::FieldDayClass))?;
            let section = ArrlSection::from_code(r.take_u32(7) as u8).ok_or(invalid(Field::Section))?;
            Ok(Message::FieldDay {
                to,
                de,
                ack,
                transmitters,
                class,
                section,
            })
        }
        (0, 5) => {
            let data = Telemetry::from_bits(r.take(71));
            Ok(Message::Telemetry { data })
        }
        (0, _) => Err(UnpackError::InvalidType { i3, n3 }),
        (1 | 2, _) => {
            let suffix = if i3 == 1 { "/R" } else { "/P" };
            let a = r.take_u32(28);
            let flag_a = r.flag();
            let b = r.take_u32(28);
            let flag_b = r.flag();
            let ack = r.flag();
            let g = r.take_u32(15);
            let to = match C28::decode(a).ok_or(invalid(Field::Callsign))? {
                C28::De | C28::Qrz | C28::Cq(_) | C28::Hash(_) if flag_a => {
                    return Err(invalid(Field::SuffixFlag));
                }
                C28::De => Addressee::De,
                C28::Qrz => Addressee::Qrz,
                C28::Cq(modifier) => Addressee::Cq { modifier },
                C28::Hash(h) => Addressee::Station(Station::Hashed(resolve(h, HashWidth::Bits22))),
                C28::Base { call, .. } => {
                    Addressee::Station(Station::Call(with_suffix(call, flag_a, suffix)?))
                }
            };
            let de = match C28::decode(b) {
                Some(C28::Base { call, .. }) => Station::Call(with_suffix(call, flag_b, suffix)?),
                Some(C28::Hash(_)) if flag_b => return Err(invalid(Field::SuffixFlag)),
                Some(C28::Hash(h)) => Station::Hashed(resolve(h, HashWidth::Bits22)),
                _ => return Err(invalid(Field::Callsign)),
            };
            let exchange = exchange(ack, g)?;
            Ok(Message::Standard { to, de, exchange })
        }
        (3, _) => {
            let tu = r.flag();
            let to = station(r.take_u32(28))?;
            let de = station(r.take_u32(28))?;
            let ack = r.flag();
            let report = SignalStrength::new(r.take_u32(3) as u8 + 2).map_err(|_| invalid(Field::Report))?;
            let exchange =
                RoundupExchange::from_s13(r.take_u32(13) as u16).ok_or(invalid(Field::RoundupExchange))?;
            Ok(Message::RttyRoundup {
                tu,
                to,
                de,
                ack,
                report,
                exchange,
            })
        }
        (4, _) => {
            let h12 = r.take_u32(12);
            let call = unpack58(r.take(58) as u64).ok_or(invalid(Field::Callsign))?;
            let hashed_second = r.flag();
            let reply = r.take_u32(2) as u8;
            let cq = r.flag();
            if cq {
                // QEX: h12 is ignored in a CQ. The h1 flag has no meaning there either.
                if reply != 0 {
                    return Err(invalid(Field::Reply));
                }
                Ok(Message::NonStandardCq { call })
            } else {
                let hashed = resolve(h12, HashWidth::Bits12);
                let reply = Reply::from_code(reply);
                Ok(Message::NonStandard {
                    call,
                    hashed,
                    hashed_second,
                    reply,
                })
            }
        }
        (5, _) => {
            let to = resolve(r.take_u32(12), HashWidth::Bits12);
            let de = resolve(r.take_u32(22), HashWidth::Bits22);
            let ack = r.flag();
            let report = SignalStrength::new(r.take_u32(3) as u8 + 2).map_err(|_| invalid(Field::Report))?;
            let serial = r.take_u32(11) as u16;
            let grid = Grid6::from_index(r.take_u32(25)).ok_or(invalid(Field::Grid6))?;
            Ok(Message::EuVhf {
                to,
                de,
                ack,
                report,
                serial,
                grid,
            })
        }
        _ => Err(UnpackError::InvalidType { i3, n3 }),
    }
}

fn with_suffix(call: super::Callsign, flag: bool, suffix: &str) -> Result<super::Callsign, UnpackError> {
    if flag {
        call.with_suffix(suffix)
            .ok_or(UnpackError::InvalidField(Field::Callsign))
    } else {
        Ok(call)
    }
}

/// The last word of a standard message from the R1 flag and g15.
fn exchange(ack: bool, g: u32) -> Result<Exchange, UnpackError> {
    let invalid = |field| UnpackError::InvalidField(field);
    match g {
        G15_RR73_AS_GRID | G15_BLANK..=G15_73 if ack => Err(invalid(Field::Acknowledgement)),
        G15_RR73_AS_GRID => Ok(Exchange::Rr73),
        0..=32_399 => {
            let grid = Grid::from_index(g as u16).ok_or(invalid(Field::Grid))?;
            Ok(Exchange::Grid { grid, ack })
        }
        G15_BLANK => Ok(Exchange::Blank),
        G15_RRR => Ok(Exchange::Rrr),
        G15_RR73 => Ok(Exchange::Rr73),
        G15_73 => Ok(Exchange::SeventyThree),
        32_405.. => {
            let report = Report::new(g as i32 - G15_REPORT_ZERO).map_err(|_| invalid(Field::Report))?;
            Ok(Exchange::Report { report, ack })
        }
        _ => Err(invalid(Field::Grid)),
    }
}
