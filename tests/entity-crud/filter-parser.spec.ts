import { parseQuery } from '../../src/entity-crud/filter-parser';

describe('filter-parser — parseQuery', () => {
  it('returns defaults for empty input', () => {
    const q = parseQuery({});
    expect(q.page).toBe(1);
    expect(q.pageSize).toBe(25);
    expect(q.order).toBe('asc');
    expect(q.filters).toEqual({});
    expect(q.q).toBeUndefined();
    expect(q.sort).toBeUndefined();
  });

  it('clamps page/pageSize to bounds', () => {
    expect(parseQuery({ page: '0' } as any).page).toBe(1);
    expect(parseQuery({ pageSize: '99999' } as any).pageSize).toBe(1000);
    expect(parseQuery({ page: '-5' } as any).page).toBe(1);
    expect(parseQuery({ pageSize: '0' } as any).pageSize).toBe(1);
  });

  it('parses search term', () => {
    const q = parseQuery({ q: 'alice' });
    expect(q.q).toBe('alice');
  });

  it('drops empty search term', () => {
    const q = parseQuery({ q: '' });
    expect(q.q).toBeUndefined();
  });

  it('parses sort + order', () => {
    const q = parseQuery({ sort: 'createdAt', order: 'desc' });
    expect(q.sort).toBe('createdAt');
    expect(q.order).toBe('desc');
  });

  it('defaults order to asc for unknown values', () => {
    expect(parseQuery({ order: 'foobar' }).order).toBe('asc');
  });

  it('parses filter[field]=value as eq', () => {
    const q = parseQuery({ filter: { status: 'active' } });
    expect(q.filters['status']).toEqual({ eq: 'active' });
  });

  it('parses comma-separated filter as in', () => {
    const q = parseQuery({ filter: { status: 'active,inactive' } });
    expect(q.filters['status']).toEqual({ in: ['active', 'inactive'] });
  });

  it('trims spaces around comma-separated filter values', () => {
    const q = parseQuery({ filter: { role: 'admin, user ' } });
    expect(q.filters['role']).toEqual({ in: ['admin', 'user'] });
  });

  it('parses filter[field][from]/[to] as range', () => {
    const q = parseQuery({
      filter: {
        createdAt: { from: '2026-01-01', to: '2026-12-31' } as any,
      },
    });
    expect(q.filters['createdAt']).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });
  });

  it('parses range with only "from"', () => {
    const q = parseQuery({
      filter: { createdAt: { from: '2026-01-01' } as any },
    });
    expect(q.filters['createdAt']).toEqual({ from: '2026-01-01' });
  });

  it('tolerates null/undefined safely', () => {
    const q = parseQuery(null as any);
    expect(q.page).toBe(1);
    expect(q.filters).toEqual({});
  });
});
