import { rowsToCsv } from '../../src/entity-crud/export';

describe('rowsToCsv', () => {
  it('emits header + rows', () => {
    const csv = rowsToCsv(
      [
        { a: 1, b: 'x' },
        { a: 2, b: 'y' },
      ],
      { fields: ['a', 'b'] },
    );
    const [hdr, r1, r2] = csv.split('\r\n');
    expect(hdr).toBe('a,b');
    expect(r1).toBe('1,x');
    expect(r2).toBe('2,y');
  });

  it('quotes values with commas, quotes and newlines', () => {
    const csv = rowsToCsv([{ s: 'a, b' }], { fields: ['s'] });
    expect(csv.split('\r\n')[1]).toBe('"a, b"');

    const csv2 = rowsToCsv([{ s: 'a "b"' }], { fields: ['s'] });
    expect(csv2.split('\r\n')[1]).toBe('"a ""b"""');

    const csv3 = rowsToCsv([{ s: 'a\nb' }], { fields: ['s'] });
    expect(csv3.split('\r\n')[1]).toBe('"a\nb"');
  });

  it('serializes nested objects as JSON', () => {
    const csv = rowsToCsv([{ o: { x: 1 } }], { fields: ['o'] });
    expect(csv.split('\r\n')[1]).toBe('"{""x"":1}"');
  });

  it('renders empty string for null/undefined', () => {
    const csv = rowsToCsv([{ a: null, b: undefined }], {
      fields: ['a', 'b'],
    });
    expect(csv.split('\r\n')[1]).toBe(',');
  });

  it('uses custom headers when provided', () => {
    const csv = rowsToCsv([{ a: 1 }], { fields: ['a'], headers: ['Alpha'] });
    expect(csv.split('\r\n')[0]).toBe('Alpha');
  });

  it('derives field order from union of rows when fields omitted', () => {
    const csv = rowsToCsv([{ a: 1 }, { b: 2 }]);
    const [hdr] = csv.split('\r\n');
    expect(hdr!.split(',').sort()).toEqual(['a', 'b']);
  });
});
