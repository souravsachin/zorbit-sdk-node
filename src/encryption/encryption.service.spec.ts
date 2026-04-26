import { EncryptionService } from './encryption.service';
import { Encrypted, setEncryptionService, encryptAll, decryptAll } from './encrypted.decorator';

describe('EncryptionService', () => {
  const key1 = Buffer.alloc(32, 1); // all 0x01
  const key2 = Buffer.alloc(32, 2); // all 0x02

  function newSvc(active = 'k1', keys = [{ keyId: 'k1', material: key1 }]) {
    return new EncryptionService({ activeKeyId: active, keys });
  }

  it('round-trips a plaintext string', async () => {
    const svc = newSvc();
    const ct = await svc.encrypt('hello world');
    expect(ct.startsWith('v1:k1:')).toBe(true);
    expect(ct.split(':')).toHaveLength(5);
    const pt = await svc.decrypt(ct);
    expect(pt).toBe('hello world');
  });

  it('produces different ciphertext for the same plaintext (random IV)', async () => {
    const svc = newSvc();
    const ct1 = await svc.encrypt('same');
    const ct2 = await svc.encrypt('same');
    expect(ct1).not.toBe(ct2);
    expect(await svc.decrypt(ct1)).toBe('same');
    expect(await svc.decrypt(ct2)).toBe('same');
  });

  it('decrypts with a retired key (key rotation)', async () => {
    // Encrypt with k1
    const svcOld = newSvc('k1', [{ keyId: 'k1', material: key1 }]);
    const ct = await svcOld.encrypt('legacy-pii');

    // New service has k2 active but k1 retained for decryption
    const svcNew = new EncryptionService({
      activeKeyId: 'k2',
      keys: [
        { keyId: 'k1', material: key1 },
        { keyId: 'k2', material: key2 },
      ],
    });
    expect(await svcNew.decrypt(ct)).toBe('legacy-pii');

    // New encryptions use k2
    const ct2 = await svcNew.encrypt('new-pii');
    expect(ct2.startsWith('v1:k2:')).toBe(true);
  });

  it('rejects tampered ciphertext (auth tag check)', async () => {
    const svc = newSvc();
    const ct = await svc.encrypt('secret');
    const parts = ct.split(':');
    // Flip a byte in the ciphertext portion
    const ctBuf = Buffer.from(parts[4], 'base64');
    ctBuf[0] ^= 0xff;
    parts[4] = ctBuf.toString('base64');
    const tampered = parts.join(':');
    await expect(svc.decrypt(tampered)).rejects.toThrow();
  });

  it('rejects ciphertext encrypted under unknown key', async () => {
    const svc = newSvc();
    const ct = await svc.encrypt('secret');
    const parts = ct.split(':');
    parts[1] = 'kZ';
    await expect(svc.decrypt(parts.join(':'))).rejects.toThrow(/Unknown encryption keyId/);
  });

  it('rejects malformed envelope', async () => {
    const svc = newSvc();
    await expect(svc.decrypt('not-an-envelope')).rejects.toThrow();
    await expect(svc.decrypt('v1:k1:short')).rejects.toThrow();
  });

  it('rejects unsupported envelope version', async () => {
    const svc = newSvc();
    await expect(svc.decrypt('v9:k1:a:b:c')).rejects.toThrow(/version/);
  });

  it('throws if active key not in keys', () => {
    expect(
      () => new EncryptionService({ activeKeyId: 'kZ', keys: [{ keyId: 'k1', material: key1 }] }),
    ).toThrow(/not found/);
  });

  it('throws if key length is wrong', () => {
    expect(
      () =>
        new EncryptionService({
          activeKeyId: 'k1',
          keys: [{ keyId: 'k1', material: Buffer.alloc(16) }],
        }),
    ).toThrow(/32 bytes/);
  });

  it('isEnvelope correctly identifies v1 envelopes', () => {
    expect(EncryptionService.isEnvelope('v1:k1:a:b:c')).toBe(true);
    expect(EncryptionService.isEnvelope('plain text')).toBe(false);
    expect(EncryptionService.isEnvelope('v1:only:three')).toBe(false);
    expect(EncryptionService.isEnvelope(null)).toBe(false);
    expect(EncryptionService.isEnvelope(123)).toBe(false);
  });

  it('generateKey returns a 32-byte base64 key', () => {
    const k = EncryptionService.generateKey();
    expect(Buffer.from(k, 'base64').length).toBe(32);
  });

  it('fromEnv reads PII_ENCRYPTION_KEY', async () => {
    const original = process.env.PII_ENCRYPTION_KEY;
    process.env.PII_ENCRYPTION_KEY = key1.toString('base64');
    try {
      const svc = EncryptionService.fromEnv();
      const ct = await svc.encrypt('env-test');
      expect(await svc.decrypt(ct)).toBe('env-test');
    } finally {
      if (original === undefined) delete process.env.PII_ENCRYPTION_KEY;
      else process.env.PII_ENCRYPTION_KEY = original;
    }
  });

  it('fromEnv parses PII_ENCRYPTION_KEYS rotation array', async () => {
    process.env.PII_ENCRYPTION_KEYS = JSON.stringify([
      { keyId: 'k1', material: key1.toString('base64') },
      { keyId: 'k2', material: key2.toString('base64') },
    ]);
    process.env.PII_ENCRYPTION_ACTIVE_KEY_ID = 'k2';
    try {
      const svc = EncryptionService.fromEnv();
      const ct = await svc.encrypt('rotated');
      expect(ct.startsWith('v1:k2:')).toBe(true);
      expect(await svc.decrypt(ct)).toBe('rotated');
    } finally {
      delete process.env.PII_ENCRYPTION_KEYS;
      delete process.env.PII_ENCRYPTION_ACTIVE_KEY_ID;
    }
  });
});

describe('@Encrypted decorator', () => {
  beforeAll(() => {
    setEncryptionService(
      new EncryptionService({
        activeKeyId: 'k1',
        keys: [{ keyId: 'k1', material: Buffer.alloc(32, 7) }],
      }),
    );
  });

  class FakeEntity {
    @Encrypted()
    pan!: string;

    @Encrypted()
    aadhaar!: string;

    plain!: string;
  }

  it('encryptAll converts plaintext fields to envelopes', async () => {
    const e = new FakeEntity();
    e.pan = 'ABCDE1234F';
    e.aadhaar = '123412341234';
    e.plain = 'not encrypted';

    await encryptAll(e, ['pan', 'aadhaar']);
    expect(EncryptionService.isEnvelope(e.pan)).toBe(true);
    expect(EncryptionService.isEnvelope(e.aadhaar)).toBe(true);
    expect(e.plain).toBe('not encrypted');
  });

  it('decryptAll restores plaintext from envelopes', async () => {
    const e = new FakeEntity();
    e.pan = 'XYZAB9876P';
    e.aadhaar = '999988887777';
    await encryptAll(e, ['pan', 'aadhaar']);
    await decryptAll(e, ['pan', 'aadhaar']);
    expect(e.pan).toBe('XYZAB9876P');
    expect(e.aadhaar).toBe('999988887777');
  });

  it('encryptAll is idempotent (does not double-encrypt)', async () => {
    const e = new FakeEntity();
    e.pan = 'DUPLI1234X';
    await encryptAll(e, ['pan']);
    const once = e.pan;
    await encryptAll(e, ['pan']);
    expect(e.pan).toBe(once); // unchanged because already an envelope
  });
});
