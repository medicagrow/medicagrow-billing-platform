/**
 * Minimal RFC 4180 CSV reader.
 *
 * Written by hand rather than pulled from a dependency: the input is a small,
 * known-shape file and this removes the last third-party parser from the
 * upload path. Handles quoted fields containing commas, newlines and escaped
 * double quotes, plus both CRLF and LF line endings.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let index = 0;

  // Strip a UTF-8 BOM — Excel adds one on "Save as CSV".
  if (text.charCodeAt(0) === 0xfeff) {
    index = 1;
  }

  const pushField = () => {
    row.push(field);
    field = "";
  };

  const pushRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = "";
  };

  while (index < text.length) {
    const char = text[index]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }

    if (char === ",") {
      pushField();
      index += 1;
      continue;
    }

    if (char === "\r") {
      // Consume CRLF or a lone CR as one terminator.
      pushRow();
      index += text[index + 1] === "\n" ? 2 : 1;
      continue;
    }

    if (char === "\n") {
      pushRow();
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  // Trailing field/row unless the file ended exactly on a newline.
  if (field !== "" || row.length > 0) {
    pushRow();
  }

  return rows;
}

/** True when every cell in the row is blank. */
export function isBlankRow(row: string[]): boolean {
  return row.every((cell) => cell.trim() === "");
}
