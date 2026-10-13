// CSV as RFC 4180 writes it: comma separated, double quotes around fields that need them, a
// doubled quote for a literal one, CRLF or LF line ends. A leading byte-order mark is dropped.

/** Parses CSV text into rows of fields. Empty lines are skipped. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const endRow = () => {
    row.push(field);
    field = '';
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') endRow();
    else if (c === '\r') {
      if (text[i + 1] !== '\n') endRow();
    } else field += c;
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

/** Rows as objects keyed by the header row's names. */
export function csvRecords(rows) {
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}
