//! ITA2 (Baudot-Murray) five-bit code with LTRS and FIGS shifts.
//!
//! A code is a 5-bit value whose bit 0 is the first data bit on the air; a 1 bit is mark.

use serde::{Deserialize, Serialize};

use crate::config::Figures;

/// Blank (all space). Prints nothing.
pub const NUL: u8 = 0x00;
/// Line feed.
pub const LF: u8 = 0x02;
/// Space.
pub const SPACE: u8 = 0x04;
/// Carriage return.
pub const CR: u8 = 0x08;
/// Shift to figures case.
pub const FIGS: u8 = 0x1B;
/// Shift to letters case. Sent repeatedly, it is the idle diddle.
pub const LTRS: u8 = 0x1F;

const NONE: char = '\0';

const LETTERS: [char; 32] = [
    NONE, 'E', '\n', 'A', ' ', 'S', 'I', 'U', '\r', 'D', 'R', 'J', 'N', 'F', 'C', 'K', 'T', 'Z', 'L', 'W',
    'H', 'Y', 'P', 'Q', 'O', 'B', 'G', NONE, 'M', 'X', 'V', NONE,
];

const FIGURES_ITA2: [char; 32] = [
    NONE, '3', '\n', '-', ' ', '\'', '8', '7', '\r', '\u{5}', '4', '\u{7}', ',', NONE, ':', '(', '5', '+',
    ')', '2', NONE, '6', '0', '1', '9', '?', NONE, NONE, '.', '/', '=', NONE,
];

const FIGURES_US: [char; 32] = [
    NONE, '3', '\n', '-', ' ', '\u{7}', '8', '7', '\r', '$', '4', '\'', ',', '!', ':', '(', '5', '"', ')',
    '2', '#', '6', '0', '1', '9', '?', '&', NONE, '.', '/', ';', NONE,
];

/// Letters or figures case.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Case {
    /// Letters case, selected by LTRS.
    Letters,
    /// Figures case, selected by FIGS.
    Figures,
}

fn figures_table(figures: Figures) -> &'static [char; 32] {
    match figures {
        Figures::Ita2 => &FIGURES_ITA2,
        Figures::Us => &FIGURES_US,
    }
}

/// The character `code` prints in `case`, or `None` for NUL, the shifts and unassigned
/// codes. BELL is U+0007 and WRU is U+0005.
pub fn char_for(code: u8, case: Case, figures: Figures) -> Option<char> {
    let table = match case {
        Case::Letters => &LETTERS,
        Case::Figures => figures_table(figures),
    };
    let c = table[usize::from(code & 0x1F)];
    (c != NONE).then_some(c)
}

/// The code for `ch` (lower case maps to upper case) and the case it needs: `None` for
/// space, CR and LF, which print the same in both cases. `None` overall when the character
/// has no code in this table.
pub fn code_for(ch: char, figures: Figures) -> Option<(u8, Option<Case>)> {
    let ch = ch.to_ascii_uppercase();
    match ch {
        NONE => return None,
        ' ' => return Some((SPACE, None)),
        '\r' => return Some((CR, None)),
        '\n' => return Some((LF, None)),
        _ => {}
    }
    if let Some(i) = LETTERS.iter().position(|&c| c == ch) {
        return Some((i as u8, Some(Case::Letters)));
    }
    figures_table(figures)
        .iter()
        .position(|&c| c == ch)
        .map(|i| (i as u8, Some(Case::Figures)))
}

/// `text` as it reads in the other case: each letter's code read in figures case, and each
/// figure's code read in letters case. A lost FIGS prints "599 127" as "TOO QWU"; read in the
/// other case, "QWU" gives "127". Space, CR, LF, characters without a code and codes that print
/// nothing or a control character (BELL, WRU) in the other case are kept as they are.
pub fn other_case(text: &str, figures: Figures) -> String {
    text.chars()
        .map(|ch| {
            let Some((code, Some(case))) = code_for(ch, figures) else {
                return ch;
            };
            let other = match case {
                Case::Letters => Case::Figures,
                Case::Figures => Case::Letters,
            };
            match char_for(code, other, figures) {
                Some(c) if !c.is_control() => c,
                _ => ch,
            }
        })
        .collect()
}

/// Turns text into codes, inserting LTRS and FIGS as the case changes.
#[derive(Clone, Debug)]
pub struct TextEncoder {
    figures: Figures,
    unshift_on_space: bool,
    case: Option<Case>,
}

impl TextEncoder {
    /// An encoder that does not know the receiver's case, so the first character that needs a
    /// case is preceded by its shift.
    pub fn new(figures: Figures, unshift_on_space: bool) -> Self {
        Self {
            figures,
            unshift_on_space,
            case: None,
        }
    }

    /// The case the receiver is in after the codes sent so far, if known.
    pub fn case(&self) -> Option<Case> {
        self.case
    }

    /// Records the receiver's case, for example after the modulator sends LTRS diddles.
    pub fn set_case(&mut self, case: Option<Case>) {
        self.case = case;
    }

    /// Appends the codes for `ch` to `out`. A newline becomes CR LF. Returns false, and appends
    /// nothing, when the character has no code.
    pub fn push_char(&mut self, ch: char, out: &mut Vec<u8>) -> bool {
        if ch == '\n' {
            out.extend_from_slice(&[CR, LF]);
            return true;
        }
        let Some((code, need)) = code_for(ch, self.figures) else {
            return false;
        };
        if let Some(case) = need
            && self.case != Some(case)
        {
            out.push(match case {
                Case::Letters => LTRS,
                Case::Figures => FIGS,
            });
            self.case = Some(case);
        }
        out.push(code);
        if code == SPACE && self.unshift_on_space && self.case == Some(Case::Figures) {
            self.case = Some(Case::Letters);
        }
        true
    }

    /// Encodes `text`. CR LF pairs become one CR LF. Returns the codes and the number of
    /// characters skipped because they have no code.
    pub fn encode(&mut self, text: &str) -> (Vec<u8>, usize) {
        let mut out = Vec::with_capacity(text.len() + 8);
        let mut skipped = 0;
        let mut chars = text.chars().peekable();
        while let Some(ch) = chars.next() {
            if ch == '\r' && chars.peek() == Some(&'\n') {
                continue;
            }
            if !self.push_char(ch, &mut out) {
                skipped += 1;
            }
        }
        (out, skipped)
    }
}

/// What one received code means.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decoded {
    /// A printing or control character.
    Char(char),
    /// LTRS or FIGS.
    Shift(Case),
    /// NUL or an unassigned code.
    Nothing,
}

/// Turns received codes into characters, following LTRS and FIGS.
#[derive(Clone, Debug)]
pub struct TextDecoder {
    figures: Figures,
    unshift_on_space: bool,
    case: Case,
}

impl TextDecoder {
    /// A decoder in letters case.
    pub fn new(figures: Figures, unshift_on_space: bool) -> Self {
        Self {
            figures,
            unshift_on_space,
            case: Case::Letters,
        }
    }

    /// The current case.
    pub fn case(&self) -> Case {
        self.case
    }

    /// Returns to letters case.
    pub fn reset(&mut self) {
        self.case = Case::Letters;
    }

    /// Decodes one code (the low 5 bits are used).
    pub fn push(&mut self, code: u8) -> Decoded {
        match code & 0x1F {
            LTRS => {
                self.case = Case::Letters;
                Decoded::Shift(Case::Letters)
            }
            FIGS => {
                self.case = Case::Figures;
                Decoded::Shift(Case::Figures)
            }
            c => {
                let out = char_for(c, self.case, self.figures).map_or(Decoded::Nothing, Decoded::Char);
                if c == SPACE && self.unshift_on_space {
                    self.case = Case::Letters;
                }
                out
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode_all(codes: &[u8], figures: Figures, usos: bool) -> String {
        let mut d = TextDecoder::new(figures, usos);
        codes
            .iter()
            .filter_map(|&c| match d.push(c) {
                Decoded::Char(ch) => Some(ch),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn letters_follow_the_ita2_bit_patterns() {
        // Bit 1 (first on the air) is the least significant bit; 1 is mark.
        assert_eq!(code_for('E', Figures::Us), Some((0b00001, Some(Case::Letters))));
        assert_eq!(code_for('a', Figures::Us), Some((0b00011, Some(Case::Letters))));
        assert_eq!(code_for('T', Figures::Us), Some((0b10000, Some(Case::Letters))));
        assert_eq!(code_for('V', Figures::Us), Some((0b11110, Some(Case::Letters))));
        assert_eq!(code_for('5', Figures::Ita2), Some((0b10000, Some(Case::Figures))));
        assert_eq!(code_for(' ', Figures::Us), Some((SPACE, None)));
        assert_eq!(code_for('~', Figures::Us), None);
        assert_eq!(code_for('$', Figures::Ita2), None);
        assert_eq!(code_for('=', Figures::Us), None);
    }

    #[test]
    fn every_character_round_trips_in_both_tables() {
        for figures in [Figures::Ita2, Figures::Us] {
            for usos in [false, true] {
                let mut text = String::new();
                for code in 0..32u8 {
                    for case in [Case::Letters, Case::Figures] {
                        if let Some(c) = char_for(code, case, figures)
                            && c != '\r'
                            && c != '\n'
                        {
                            text.push(c);
                            text.push(' ');
                        }
                    }
                }
                text.push_str("1 2 A 3\nB");
                let (codes, skipped) = TextEncoder::new(figures, usos).encode(&text);
                assert_eq!(skipped, 0);
                assert_eq!(decode_all(&codes, figures, usos), text.replace('\n', "\r\n"));
            }
        }
    }

    #[test]
    fn tables_differ_where_expected() {
        let differ: Vec<u8> = (0..32u8)
            .filter(|&c| char_for(c, Case::Figures, Figures::Ita2) != char_for(c, Case::Figures, Figures::Us))
            .collect();
        assert_eq!(differ, vec![0x05, 0x09, 0x0B, 0x0D, 0x11, 0x14, 0x1A, 0x1E]);
    }

    #[test]
    fn unshift_on_space_resends_figs() {
        let (codes, _) = TextEncoder::new(Figures::Us, true).encode("5 5");
        assert_eq!(codes, vec![FIGS, 0x10, SPACE, FIGS, 0x10]);
        let (codes, _) = TextEncoder::new(Figures::Us, false).encode("5 5 A");
        assert_eq!(codes, vec![FIGS, 0x10, SPACE, 0x10, SPACE, LTRS, 0x03]);
        // A receiver without unshift on space prints the letter after a space as a figure.
        let (codes, _) = TextEncoder::new(Figures::Us, true).encode("5 E");
        assert_eq!(decode_all(&codes, Figures::Us, false), "5 3");
        assert_eq!(decode_all(&codes, Figures::Us, true), "5 E");
    }

    #[test]
    fn other_case_reads_letters_as_figures_and_back() {
        assert_eq!(other_case("QWU", Figures::Us), "127");
        assert_eq!(other_case("TOO QWU", Figures::Us), "599 127");
        assert_eq!(other_case("599 127", Figures::Us), "TOO QWU");
        assert_eq!(other_case("QWERTYUIOP", Figures::Ita2), "1234567890");
        assert_eq!(other_case("qwu", Figures::Us), "127");
        assert_eq!(other_case("5NN", Figures::Us), "T,,");
        // F has a figure in the US table only; S is BELL in US figures and kept.
        assert_eq!(other_case("F", Figures::Us), "!");
        assert_eq!(other_case("F", Figures::Ita2), "F");
        assert_eq!(other_case("S", Figures::Us), "S");
        assert_eq!(other_case("S", Figures::Ita2), "'");
        assert_eq!(other_case("A@B\r\n", Figures::Us), "-@?\r\n");
        assert_eq!(other_case("", Figures::Us), "");
    }

    #[test]
    fn skips_characters_without_a_code() {
        let (codes, skipped) = TextEncoder::new(Figures::Ita2, true).encode("A~B\r\nC");
        assert_eq!(skipped, 1);
        assert_eq!(decode_all(&codes, Figures::Ita2, true), "AB\r\nC");
    }
}
