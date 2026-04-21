/**
 * Parse the DataTable wire protocol into a TypeORM-where-compatible
 * structure.
 *
 * Inputs (query string as already parsed by Express):
 *   ?page=1
 *   &pageSize=25
 *   &q=<search-term>
 *   &sort=<field>
 *   &order=asc|desc
 *   &filter[status]=active,inactive
 *   &filter[role]=superadmin
 *   &filter[createdAt][from]=2026-01-01
 *   &filter[createdAt][to]=2026-12-31
 *
 * Output:
 *   { page, pageSize, q, sort, order, filters: { <field>: <shape> } }
 * where `<shape>` is one of:
 *   { eq: value }
 *   { in: [v1, v2] }       (comma-split or repeated keys)
 *   { from, to }           (range)
 *
 * The actual translation to TypeORM `Like`/`In`/`Between` is performed
 * in `service-factory.ts` so this module stays pure & testable.
 */

export type FilterShape =
  | { eq: string }
  | { in: string[] }
  | { from?: string; to?: string };

export interface ParsedQuery {
  page: number;
  pageSize: number;
  q?: string;
  sort?: string;
  order: 'asc' | 'desc';
  filters: Record<string, FilterShape>;
}

export interface RawQuery {
  page?: string | number;
  pageSize?: string | number;
  q?: string;
  sort?: string;
  order?: string;
  filter?: Record<string, string | Record<string, string>>;
}

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 1000;

export function parseQuery(raw: RawQuery | undefined | null): ParsedQuery {
  const src = raw || {};
  const page = clampInt(src.page, DEFAULT_PAGE, 1, 1e6);
  const pageSize = clampInt(
    src.pageSize,
    DEFAULT_PAGE_SIZE,
    1,
    MAX_PAGE_SIZE,
  );

  const order =
    typeof src.order === 'string' && src.order.toLowerCase() === 'desc'
      ? 'desc'
      : 'asc';

  const filters: Record<string, FilterShape> = {};
  if (src.filter && typeof src.filter === 'object') {
    for (const [field, val] of Object.entries(src.filter)) {
      filters[field] = coerceFilter(val);
    }
  }

  const out: ParsedQuery = {
    page,
    pageSize,
    order,
    filters,
  };

  if (typeof src.q === 'string' && src.q.length > 0) out.q = src.q;
  if (typeof src.sort === 'string' && src.sort.length > 0) out.sort = src.sort;

  return out;
}

function clampInt(
  v: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function coerceFilter(
  val: string | Record<string, string> | unknown,
): FilterShape {
  if (val === null || val === undefined) {
    return { eq: '' };
  }
  if (typeof val === 'string') {
    if (val.includes(',')) {
      return { in: val.split(',').map((s) => s.trim()).filter(Boolean) };
    }
    return { eq: val };
  }
  if (typeof val === 'object') {
    const rec = val as Record<string, string>;
    const range: { from?: string; to?: string } = {};
    if (typeof rec.from === 'string') range.from = rec.from;
    if (typeof rec.to === 'string') range.to = rec.to;
    if ('from' in range || 'to' in range) return range;
    // Fallback: flatten first value
    const first = Object.values(rec)[0];
    return { eq: typeof first === 'string' ? first : '' };
  }
  return { eq: String(val) };
}
