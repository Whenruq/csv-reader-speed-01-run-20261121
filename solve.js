// A fast drop-in for csv-reader 1.0.0: run(input) returns exactly the {columns, rows, errors} that
// csv-reader 1.0.0's readCsv returns for the same {text, header}, by the same broken-row policy:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled, "" inside it one quote, and each
//     CRLF or lone CR inside it is read as LF; what follows its closing quote, up to the next comma or line break,
//     is appended to it as it stands (quote_junk, when the field ends); a quote that never closes is read as a
//     literal character and the text after it is read again as an unquoted field (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the records after it (every record
//     when header is false), each padded with "" (short_row, with fields: its count) or cut (long_row, with extra:
//     the cut fields) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record starts on (every LF, CRLF and lone CR
//     inside a quoted field counted), row its record's index in rows (null for the header), in the order met.
//
// Where the reference reads one character at a time and builds each field a character at a time, this reader
// scans by index and takes each field (or each clean run of it) with one slice. The slow paths — stray CRs in an
// unquoted field, doubled quotes or CRs inside a quoted one — build the field from the slices between the special
// characters, so the common field costs one scan and one slice. Pure: no clock, no randomness, no locale,
// nothing kept from one call to the next.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, how it ended, and how many characters the last unquoted read kept.
  let fv = '';
  let fe = END;
  let fa = 0;

  // Reads unquoted characters from pos onto `prefix`, up to the next comma or line break; a CR not followed by
  // LF is dropped (stray_cr). Sets fv/fe/fa and advances pos/line.
  function readUnquoted(prefix) {
    const start = pos;
    let i = pos;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 44) { // ,
        fv = prefix + text.slice(start, i);
        fa = i - start;
        pos = i + 1;
        fe = COMMA;
        return;
      }
      if (c === 10) { // \n
        fv = prefix + text.slice(start, i);
        fa = i - start;
        pos = i + 1;
        line += 1;
        fe = LINE_BREAK;
        return;
      }
      if (c === 13) { // \r
        if (text.charCodeAt(i + 1) === 10) {
          fv = prefix + text.slice(start, i);
          fa = i - start;
          pos = i + 2;
          line += 1;
          fe = LINE_BREAK;
          return;
        }
        break; // a stray CR: take the slow path from here
      }
      i += 1;
    }
    if (i >= n) {
      fv = prefix + text.slice(start, i);
      fa = i - start;
      pos = i;
      fe = END;
      return;
    }
    // Slow path: at least one stray CR in this field. Keep the clean runs, drop each stray CR.
    let value = prefix + text.slice(start, i);
    let added = i - start;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 44) {
        fv = value;
        fa = added;
        pos = i + 1;
        fe = COMMA;
        return;
      }
      if (c === 10) {
        fv = value;
        fa = added;
        pos = i + 1;
        line += 1;
        fe = LINE_BREAK;
        return;
      }
      if (c === 13) {
        if (text.charCodeAt(i + 1) === 10) {
          fv = value;
          fa = added;
          pos = i + 2;
          line += 1;
          fe = LINE_BREAK;
          return;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        i += 1;
        continue;
      }
      // A clean run: take it in one slice.
      const runStart = i;
      i += 1;
      while (i < n) {
        const d = text.charCodeAt(i);
        if (d === 44 || d === 10 || d === 13) break;
        i += 1;
      }
      value += text.slice(runStart, i);
      added += i - runStart;
    }
    fv = value;
    fa = added;
    pos = i;
    fe = END;
  }

  // Reads a quoted field whose opening quote is at pos. Sets fv/fe and advances pos/line.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let i = pos + 1;
    let lines = 0; // line breaks met inside the quotes, committed only if the quote closes
    let special = -1; // index of the first doubled quote or CR inside, -1 while the span is clean
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 34) { // "
        if (text.charCodeAt(i + 1) === 34) {
          if (special < 0) special = i;
          i += 2;
          continue;
        }
        // The closing quote is at i.
        let value;
        if (special < 0) {
          value = text.slice(open + 1, i);
        } else {
          value = buildQuoted(open + 1, i);
        }
        line += lines;
        pos = i + 1;
        if (pos >= n) {
          fv = value;
          fe = END;
          return;
        }
        const d = text.charCodeAt(pos);
        if (d === 44) {
          pos += 1;
          fv = value;
          fe = COMMA;
          return;
        }
        if (d === 10) {
          pos += 1;
          line += 1;
          fv = value;
          fe = LINE_BREAK;
          return;
        }
        if (d === 13 && text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          fv = value;
          fe = LINE_BREAK;
          return;
        }
        // What follows the closing quote is appended as it stands.
        readUnquoted(value);
        if (fa > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        return;
      }
      if (c === 13) { // \r inside quotes: one LF, one line
        if (special < 0) special = i;
        lines += 1;
        i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
        continue;
      }
      if (c === 10) lines += 1;
      i += 1;
    }
    // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
    pos = open + 1;
    line = openLine;
    errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
    readUnquoted('"');
  }

  // Builds a quoted field's value from [start, end) when the span holds doubled quotes or CRs: "" is one quote,
  // each CRLF or lone CR is one LF. (Line breaks were already counted by the caller's scan.)
  function buildQuoted(start, end) {
    let value = '';
    let i = start;
    let runStart = start;
    while (i < end) {
      const c = text.charCodeAt(i);
      if (c === 34) { // "" inside the span (a lone quote would have closed it)
        value += text.slice(runStart, i) + '"';
        i += 2;
        runStart = i;
        continue;
      }
      if (c === 13) {
        value += text.slice(runStart, i) + '\n';
        i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
        runStart = i;
        continue;
      }
      i += 1;
    }
    return value + text.slice(runStart, end);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted();
      else readUnquoted('');
      fields.push(fv);
    } while (fe === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
