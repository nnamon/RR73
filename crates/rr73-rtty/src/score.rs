//! Character error rate between sent and received text.

/// Text as compared: CR LF and lone CR become LF, and other control characters (NUL, BELL,
/// WRU) are dropped.
pub fn normalize(text: &str) -> String {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .chars()
        .filter(|&c| c == '\n' || !c.is_control())
        .collect()
}

/// Levenshtein distance between `a` and `b`, in characters: the fewest substitutions,
/// insertions and deletions that turn one into the other.
pub fn edit_distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0; b.len() + 1];
    for (i, ca) in a.iter().enumerate() {
        cur[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let sub = prev[j] + usize::from(ca != cb);
            cur[j + 1] = sub.min(prev[j + 1] + 1).min(cur[j] + 1);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

/// Character errors in `received` against `sent`, both normalized: the edit distance and the
/// sent length in characters. The character error rate is their ratio.
pub fn char_errors(sent: &str, received: &str) -> (usize, usize) {
    let sent = normalize(sent);
    let received = normalize(received);
    (edit_distance(&sent, &received), sent.chars().count())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_edits() {
        assert_eq!(edit_distance("", ""), 0);
        assert_eq!(edit_distance("ABC", ""), 3);
        assert_eq!(edit_distance("", "AB"), 2);
        assert_eq!(edit_distance("KITTEN", "SITTING"), 3);
        assert_eq!(char_errors("CQ TEST\n", "CQ TEST\r\n\u{7}"), (0, 8));
        assert_eq!(char_errors("599 001", "599 0O1"), (1, 7));
    }
}
