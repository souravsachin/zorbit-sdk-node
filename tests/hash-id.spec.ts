import { generateHashId, validateHashId } from '../src/utils/hash-id';

describe('generateHashId', () => {
  it('should generate an ID with the given prefix', () => {
    const id = generateHashId('U');
    expect(id).toMatch(/^U-[0-9A-F]{4}$/);
  });

  it('should generate IDs with multi-character prefixes', () => {
    const id = generateHashId('EV');
    expect(id).toMatch(/^EV-[0-9A-F]{4}$/);
  });

  it('should generate IDs with DOC prefix', () => {
    const id = generateHashId('DOC');
    expect(id).toMatch(/^DOC-[0-9A-F]{4}$/);
  });

  it('should generate unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateHashId('T'));
    }
    // With 2 bytes of randomness (65536 possibilities), 100 IDs should almost certainly be unique
    expect(ids.size).toBeGreaterThan(90);
  });
});

describe('validateHashId', () => {
  it('should return true for valid IDs', () => {
    expect(validateHashId('U-81F3')).toBe(true);
    expect(validateHashId('O-92AF')).toBe(true);
    expect(validateHashId('EV-883A')).toBe(true);
    expect(validateHashId('DOC-29F1')).toBe(true);
  });

  it('should return true when prefix matches', () => {
    expect(validateHashId('U-81F3', 'U')).toBe(true);
    expect(validateHashId('EV-883A', 'EV')).toBe(true);
  });

  it('should return false when prefix does not match', () => {
    expect(validateHashId('U-81F3', 'O')).toBe(false);
    expect(validateHashId('EV-883A', 'U')).toBe(false);
  });

  it('should return false for invalid IDs', () => {
    expect(validateHashId('')).toBe(false);
    expect(validateHashId('invalid')).toBe(false);
    expect(validateHashId('U-ZZZZ')).toBe(false);
    expect(validateHashId('U-81f3')).toBe(false); // lowercase
    expect(validateHashId('U-81F33')).toBe(false); // too long
    expect(validateHashId('U-81F')).toBe(false); // too short
    expect(validateHashId('-81F3')).toBe(false); // no prefix
  });

  it('should return false for null/undefined', () => {
    expect(validateHashId(null as any)).toBe(false);
    expect(validateHashId(undefined as any)).toBe(false);
  });
});
