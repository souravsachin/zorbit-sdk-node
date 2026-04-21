import {
  redactSensitive,
  diffFields,
  emitAudit,
} from '../../src/entity-crud/audit';
import { parseEntityDeclaration } from '../../src/entity-crud/entity-schema';

const decl = parseEntityDeclaration({
  entity: 'user',
  namespace: 'O',
  hashIdPrefix: 'U',
  table: 'users',
  fields: [
    { key: 'hashId', type: 'id' },
    { key: 'emailToken', type: 'email' },
    { key: 'role', type: 'text' },
  ],
  audit: { eventPrefix: 'identity.user', sensitiveFields: ['emailToken', 'role'] },
});

describe('audit — redactSensitive', () => {
  it('redacts listed fields', () => {
    const out = redactSensitive(
      { hashId: 'U-1', emailToken: 'a@b.com', role: 'admin' },
      ['emailToken', 'role'],
    );
    expect(out).toEqual({
      hashId: 'U-1',
      emailToken: '[REDACTED]',
      role: '[REDACTED]',
    });
  });

  it('returns null for null input', () => {
    expect(redactSensitive(null, ['x'])).toBeNull();
  });

  it('no-op when no sensitive fields given', () => {
    expect(redactSensitive({ a: 1 }, [])).toEqual({ a: 1 });
    expect(redactSensitive({ a: 1 }, undefined)).toEqual({ a: 1 });
  });
});

describe('audit — diffFields', () => {
  it('returns changed keys only', () => {
    expect(diffFields({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual(['b']);
  });

  it('reports added + removed', () => {
    const d = diffFields({ a: 1 }, { a: 1, b: 2 });
    expect(d).toContain('b');
  });

  it('returns empty when identical', () => {
    expect(diffFields({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it('compares nested objects via JSON', () => {
    expect(
      diffFields({ o: { x: 1 } }, { o: { x: 2 } }),
    ).toEqual(['o']);
  });
});

describe('audit — emitAudit', () => {
  it('swallows when no publisher configured', async () => {
    await expect(
      emitAudit({
        declaration: decl,
        op: 'created',
        actor: { userHashId: 'U-1', organizationHashId: 'O-1' },
        hashId: 'U-ABCD',
      }),
    ).resolves.toBeUndefined();
  });

  it('publishes with masked sensitive fields', async () => {
    const published: any[] = [];
    const publisher: any = {
      publish: async (eventType: string, ns: string, nsId: string, p: any) => {
        published.push({ eventType, ns, nsId, p });
      },
    };
    await emitAudit({
      declaration: decl,
      publisher,
      op: 'updated',
      actor: { userHashId: 'U-1', organizationHashId: 'O-42' },
      hashId: 'U-ABCD',
      before: { emailToken: 'a@b.com', role: 'user', displayName: 'Alice' },
      after: { emailToken: 'a2@b.com', role: 'admin', displayName: 'Alice' },
      namespaceId: 'O-42',
    });
    expect(published).toHaveLength(1);
    expect(published[0].eventType).toBe('identity.user.updated');
    expect(published[0].ns).toBe('O');
    expect(published[0].nsId).toBe('O-42');
    expect(published[0].p.before.emailToken).toBe('[REDACTED]');
    expect(published[0].p.before.role).toBe('[REDACTED]');
    expect(published[0].p.after.emailToken).toBe('[REDACTED]');
    expect(published[0].p.changedFields).toEqual(
      expect.arrayContaining(['emailToken', 'role']),
    );
  });

  it('never throws even if publisher fails', async () => {
    const publisher: any = {
      publish: async () => {
        throw new Error('kafka down');
      },
    };
    await expect(
      emitAudit({
        declaration: decl,
        publisher,
        op: 'created',
        actor: { userHashId: 'U-1', organizationHashId: 'O-1' },
        hashId: 'U-X',
      }),
    ).resolves.toBeUndefined();
  });
});
