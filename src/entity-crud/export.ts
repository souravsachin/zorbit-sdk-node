/**
 * CSV export for a list of rows.
 *
 * RFC 4180-ish: commas and quotes are escaped; newlines inside values
 * are preserved (quoted). No third-party dep — the fleet's csv-write
 * needs are too small to warrant adding one to the SDK.
 */

export interface CsvExportOptions {
  /** Ordered column keys; defaults to the union of every row's keys */
  fields?: string[];
  /** Optional header row override; defaults to `fields` */
  headers?: string[];
}

export function rowsToCsv(
  rows: Array<Record<string, unknown>>,
  opts: CsvExportOptions = {},
): string {
  const fields =
    opts.fields && opts.fields.length > 0
      ? opts.fields
      : unionKeys(rows);

  const headerLine = (opts.headers || fields).map(csvCell).join(',');

  const lines = rows.map((r) =>
    fields.map((f) => csvCell(r[f])).join(','),
  );

  return [headerLine, ...lines].join('\r\n');
}

function unionKeys(rows: Array<Record<string, unknown>>): string[] {
  const keys = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) keys.add(k);
  }
  return Array.from(keys);
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s =
    typeof v === 'object' ? JSON.stringify(v) : String(v);
  const needsQuoting = /[",\r\n]/.test(s);
  if (!needsQuoting) return s;
  return `"${s.replace(/"/g, '""')}"`;
}
