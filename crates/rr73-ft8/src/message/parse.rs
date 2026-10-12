//! Operator text to messages.
//!
//! Text is upper-cased and split at whitespace. The contest and DXpedition layouts are tried
//! first, then the standard and nonstandard-callsign layouts, then telemetry and free text.
//! A layout that matches the shape of the text but holds an invalid value (an odd
//! DXpedition report, an unknown section) produces an error unless the text also fits as
//! free text.

use super::callsign::{Addressee, Callsign, CqModifier, HashedCallsign, Station};
use super::codec::{self, EU_VHF_MAX_SERIAL};
use super::fields::{
    ArrlSection, Exchange, FieldDayClass, FreeText, Grid, Grid6, Reply, Report, RoundupExchange,
    SignalStrength, StateProvince, Telemetry,
};
use super::{Message, PackError};

/// `None`: the text does not have this layout. `Some(Err)`: it has the layout but a value
/// is invalid.
type Attempt = Option<Result<Message, PackError>>;

pub(crate) fn parse(text: &str) -> Result<Message, PackError> {
    let upper = text.to_ascii_uppercase();
    let words: Vec<&str> = upper.split_whitespace().collect();
    if words.is_empty() {
        return Err(PackError::Empty);
    }
    let mut first_error = None;
    let layouts: [fn(&[&str]) -> Attempt; 5] = [dxpedition, rtty_roundup, field_day, eu_vhf, standard];
    for layout in layouts {
        match layout(&words).map(|r| r.and_then(|m| codec::encode(&m).map(|_| m))) {
            Some(Ok(message)) => return Ok(message),
            Some(Err(e)) => {
                first_error.get_or_insert(e);
            }
            None => {}
        }
    }
    if let [word] = words[..]
        && word.len() > FreeText::MAX_LEN
        && word.len() <= 18
        && word.bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Telemetry::from_hex(word).map(|data| Message::Telemetry { data });
    }
    match FreeText::new(&words.join(" ")) {
        Ok(text) => Ok(Message::FreeText { text }),
        Err(e) => Err(first_error.unwrap_or(e)),
    }
}

/// A word in a callsign position.
#[derive(Clone, Copy)]
enum Word {
    /// `K1ABC`: sent in full where the field allows it.
    Plain(Callsign),
    /// `<K1ABC>`: sent as a hash.
    Bracketed(Callsign),
}

impl Word {
    fn callsign(self) -> Callsign {
        match self {
            Word::Plain(c) | Word::Bracketed(c) => c,
        }
    }

    /// A plain callsign that only a hash or the 58-bit field can carry.
    fn is_plain_nonstandard(self) -> bool {
        matches!(self, Word::Plain(c) if !c.is_standard())
    }
}

/// Reads a callsign word. `None` for a plain word that is not a callsign; an error for a
/// bracketed word that is not one, and for `<...>`.
fn word(text: &str) -> Option<Result<Word, PackError>> {
    if text == "<...>" {
        return Some(Err(PackError::UnresolvedHash));
    }
    if let Some(inner) = text.strip_prefix('<').and_then(|t| t.strip_suffix('>')) {
        return Some(Callsign::new(inner).map(Word::Bracketed));
    }
    Callsign::new(text).ok().map(|c| Ok(Word::Plain(c)))
}

/// Reads a callsign word in a layout already recognised: every failure is an error.
fn required_word(text: &str) -> Result<Word, PackError> {
    word(text).unwrap_or_else(|| Err(PackError::InvalidCallsign(text.to_string())))
}

/// A station for a 28-bit field without suffix flag: in full if standard, else hashed.
fn station28(w: Word) -> Station {
    match w {
        Word::Plain(c) if c.is_standard_base() => Station::Call(c),
        _ => Station::Hashed(HashedCallsign::Known(w.callsign())),
    }
}

/// A station for a 28-bit field with a /R or /P flag (message types 1 and 2).
fn station_flagged(w: Word) -> Station {
    match w {
        Word::Plain(c) if c.is_standard() => Station::Call(c),
        _ => Station::Hashed(HashedCallsign::Known(w.callsign())),
    }
}

/// Checks for a contest layout of `plain_len` words, or `plain_len + 1` with a standalone `R`
/// before the last two. Returns whether the `R` is present and the words unchanged: layouts
/// read callsigns from the start and the exchange from the end.
fn split_ack<'a>(words: &'a [&'a str], plain_len: usize) -> Option<(bool, &'a [&'a str])> {
    if words.len() == plain_len {
        Some((false, words))
    } else if words.len() == plain_len + 1 && words[plain_len - 2] == "R" {
        Some((true, words))
    } else {
        None
    }
}

/// `K1ABC RR73; W9XYZ <KH1/KH7Z> -08`
fn dxpedition(words: &[&str]) -> Attempt {
    if words.len() != 5 || words[1] != "RR73;" {
        return None;
    }
    Some(dxpedition_fields(words))
}

fn dxpedition_fields(words: &[&str]) -> Result<Message, PackError> {
    let rr73_to = station28(required_word(words[0])?);
    let report_to = station28(required_word(words[2])?);
    let fox = HashedCallsign::Known(required_word(words[3])?.callsign());
    let report =
        Report::parse(words[4]).unwrap_or_else(|| Err(PackError::Unsupported(words[4].to_string())))?;
    Ok(Message::Dxpedition {
        rr73_to,
        report_to,
        fox,
        report,
    })
}

/// `[TU;] K1ABC W9XYZ [R] 579 MA` or `... 579 0013`
fn rtty_roundup(words: &[&str]) -> Attempt {
    let (tu, rest) = match words.first() {
        Some(&"TU;") => (true, &words[1..]),
        _ => (false, words),
    };
    let (ack, rest) = split_ack(rest, 4)?;
    let rst = rest[rest.len() - 2].as_bytes();
    let rst_shaped = rst.len() == 3 && rst[0] == b'5' && rst[1].is_ascii_digit() && rst[2] == b'9';
    if !rst_shaped {
        return None;
    }
    let to = word(rest[0])?;
    let de = word(rest[1])?;
    Some(rtty_roundup_fields(
        tu,
        to,
        de,
        ack,
        rst[1] - b'0',
        rest[rest.len() - 1],
    ))
}

fn rtty_roundup_fields(
    tu: bool,
    to: Result<Word, PackError>,
    de: Result<Word, PackError>,
    ack: bool,
    strength: u8,
    exch: &str,
) -> Result<Message, PackError> {
    let report = SignalStrength::new(strength)?;
    let exchange = if exch.len() <= 4 && exch.bytes().all(|c| c.is_ascii_digit()) {
        let serial = exch
            .parse::<u16>()
            .map_err(|_| PackError::Unsupported(exch.to_string()))?;
        if serial > RoundupExchange::MAX_SERIAL {
            return Err(PackError::SerialOutOfRange {
                serial,
                max: RoundupExchange::MAX_SERIAL,
            });
        }
        RoundupExchange::Serial(serial)
    } else {
        RoundupExchange::State(StateProvince::new(exch)?)
    };
    Ok(Message::RttyRoundup {
        tu,
        to: station28(to?),
        de: station28(de?),
        ack,
        report,
        exchange,
    })
}

/// `K1ABC W9XYZ [R] 6A WI`
fn field_day(words: &[&str]) -> Attempt {
    let (ack, words) = split_ack(words, 4)?;
    let exch = words[words.len() - 2].as_bytes();
    let (digits, class) = exch.split_at(exch.len().checked_sub(1)?);
    let shaped = (1..=2).contains(&digits.len())
        && digits.iter().all(u8::is_ascii_digit)
        && class.first().is_some_and(u8::is_ascii_uppercase);
    if !shaped {
        return None;
    }
    let to = word(words[0])?;
    let de = word(words[1])?;
    let transmitters = digits.iter().fold(0u8, |acc, d| acc * 10 + (d - b'0'));
    Some(field_day_fields(
        to,
        de,
        ack,
        transmitters,
        char::from(class[0]),
        words[words.len() - 1],
    ))
}

fn field_day_fields(
    to: Result<Word, PackError>,
    de: Result<Word, PackError>,
    ack: bool,
    transmitters: u8,
    class: char,
    section: &str,
) -> Result<Message, PackError> {
    if !(1..=32).contains(&transmitters) {
        return Err(PackError::Transmitters(transmitters));
    }
    let class = FieldDayClass::from_letter(class)?;
    let section = ArrlSection::new(section)?;
    Ok(Message::FieldDay {
        to: station28(to?),
        de: station28(de?),
        ack,
        transmitters,
        class,
        section,
    })
}

/// `<G4ABC> <PA9XYZ> [R] 570007 JO22DB`
fn eu_vhf(words: &[&str]) -> Attempt {
    let (ack, words) = split_ack(words, 4)?;
    let rs = words[words.len() - 2].as_bytes();
    if rs.len() != 6
        || rs[0] != b'5'
        || !rs.iter().all(u8::is_ascii_digit)
        || words[words.len() - 1].len() != 6
    {
        return None;
    }
    let to = word(words[0])?;
    let de = word(words[1])?;
    Some(eu_vhf_fields(to, de, ack, rs, words[words.len() - 1]))
}

fn eu_vhf_fields(
    to: Result<Word, PackError>,
    de: Result<Word, PackError>,
    ack: bool,
    rs: &[u8],
    grid: &str,
) -> Result<Message, PackError> {
    let report = SignalStrength::new(rs[1] - b'0')?;
    let serial = rs[2..].iter().fold(0u16, |acc, d| acc * 10 + u16::from(d - b'0'));
    if serial > EU_VHF_MAX_SERIAL {
        return Err(PackError::SerialOutOfRange {
            serial,
            max: EU_VHF_MAX_SERIAL,
        });
    }
    let grid = Grid6::new(grid)?;
    let to = HashedCallsign::Known(to?.callsign());
    let de = HashedCallsign::Known(de?.callsign());
    Ok(Message::EuVhf {
        to,
        de,
        ack,
        report,
        serial,
        grid,
    })
}

/// The last word of a standard message, without a separate R.
fn exchange_word(text: &str) -> Option<Result<Exchange, PackError>> {
    match text {
        "RRR" => return Some(Ok(Exchange::Rrr)),
        "RR73" => return Some(Ok(Exchange::Rr73)),
        "73" => return Some(Ok(Exchange::SeventyThree)),
        _ => {}
    }
    if let Ok(grid) = Grid::new(text) {
        return Some(Ok(Exchange::Grid { grid, ack: false }));
    }
    if let Some(report) = Report::parse(text) {
        return Some(report.map(|report| Exchange::Report { report, ack: false }));
    }
    let report = Report::parse(text.strip_prefix('R')?)?;
    Some(report.map(|report| Exchange::Report { report, ack: true }))
}

/// `CQ [MOD] CALL [GRID]`, `QRZ CALL`, `DE CALL`, `CALL CALL [EXCHANGE]`, and type 4.
fn standard(words: &[&str]) -> Attempt {
    let mut rest = words;
    let mut exchange = Exchange::Blank;
    if let Some(last) = rest.last()
        && let Some(found) = exchange_word(last)
    {
        exchange = match found {
            Ok(e) => e,
            Err(e) => return Some(Err(e)),
        };
        rest = &rest[..rest.len() - 1];
        if rest.last() == Some(&"R") {
            exchange = match exchange {
                Exchange::Grid { grid, ack: false } => Exchange::Grid { grid, ack: true },
                Exchange::Report { report, ack: false } => Exchange::Report { report, ack: true },
                _ => return None,
            };
            rest = &rest[..rest.len() - 1];
        }
    }

    let (to, de) = match rest {
        ["CQ", de] => (Addressee::Cq { modifier: None }, *de),
        ["CQ", modifier, de] => (
            Addressee::Cq {
                modifier: Some(CqModifier::new(modifier).ok()?),
            },
            *de,
        ),
        ["QRZ", de] => (Addressee::Qrz, *de),
        ["DE", de] => (Addressee::De, *de),
        [to, de] => {
            let to = word(to)?;
            let de = word(de)?;
            return Some(stations(to, de, exchange));
        }
        _ => return None,
    };
    let de = match word(de)? {
        Ok(w) => w,
        Err(e) => return Some(Err(e)),
    };
    Some(if de.is_plain_nonstandard() {
        if to == (Addressee::Cq { modifier: None }) && exchange == Exchange::Blank {
            Ok(Message::NonStandardCq { call: de.callsign() })
        } else {
            Err(PackError::NonStandardCq(de.callsign()))
        }
    } else {
        Ok(Message::Standard {
            to,
            de: station_flagged(de),
            exchange,
        })
    })
}

/// Two callsign words and a last word: type 4 when a plain nonstandard callsign needs the
/// 58-bit field and the last word fits type 4; type 1 or 2 otherwise.
fn stations(
    to: Result<Word, PackError>,
    de: Result<Word, PackError>,
    exchange: Exchange,
) -> Result<Message, PackError> {
    let (to, de) = (to?, de?);
    let reply = match exchange {
        Exchange::Blank => Some(None),
        Exchange::Rrr => Some(Some(Reply::Rrr)),
        Exchange::Rr73 => Some(Some(Reply::Rr73)),
        Exchange::SeventyThree => Some(Some(Reply::SeventyThree)),
        Exchange::Grid { .. } | Exchange::Report { .. } => None,
    };
    if let Some(reply) = reply {
        if de.is_plain_nonstandard() {
            let hashed = HashedCallsign::Known(to.callsign());
            return Ok(Message::NonStandard {
                call: de.callsign(),
                hashed,
                hashed_second: false,
                reply,
            });
        }
        if to.is_plain_nonstandard() {
            let hashed = HashedCallsign::Known(de.callsign());
            return Ok(Message::NonStandard {
                call: to.callsign(),
                hashed,
                hashed_second: true,
                reply,
            });
        }
    }
    Ok(Message::Standard {
        to: Addressee::Station(station_flagged(to)),
        de: station_flagged(de),
        exchange,
    })
}
