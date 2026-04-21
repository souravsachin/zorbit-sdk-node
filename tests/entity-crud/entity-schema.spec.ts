import {
  parseEntityDeclaration,
  safeParseEntityDeclaration,
} from '../../src/entity-crud/entity-schema';

const VALID = {
  $schema: 'https://zorbit.onezippy.ai/schemas/entity-v1.json',
  entity: 'user',
  displayName: 'User',
  namespace: 'O',
  hashIdPrefix: 'U',
  table: 'users',
  softDelete: true,
  timestamps: true,
  version: true,
  fields: [
    { key: 'hashId', type: 'id', readonly: true },
    { key: 'emailToken', type: 'email', required: true, unique: true },
    { key: 'displayName', type: 'text', required: true, maxLength: 200 },
    { key: 'role', type: 'enum', values: ['superadmin', 'org_admin', 'user'] },
  ],
  indexes: [{ fields: ['emailToken'], unique: true }],
  privileges: {
    read: 'identity.user.read',
    create: 'identity.user.manage',
    update: 'identity.user.manage',
    delete: 'identity.user.manage',
    export: 'identity.user.read',
  },
  masking: {
    rules: [
      {
        field: 'emailToken',
        pattern: '(.{2}).*(@.*)',
        replacement: '$1***$2',
        unlessPrivilege: 'identity.user.pii.view',
      },
    ],
  },
  audit: { eventPrefix: 'identity.user', sensitiveFields: ['emailToken'] },
  search: { fields: ['displayName', 'emailToken'] },
};

describe('entity-schema', () => {
  it('parses a valid declaration', () => {
    const decl = parseEntityDeclaration(VALID);
    expect(decl.entity).toBe('user');
    expect(decl.namespace).toBe('O');
    expect(decl.fields.length).toBe(4);
    expect(decl.softDelete).toBe(true);
  });

  it('defaults softDelete, timestamps, version to true when omitted', () => {
    const copy = { ...VALID } as any;
    delete copy.softDelete;
    delete copy.timestamps;
    delete copy.version;
    const decl = parseEntityDeclaration(copy);
    expect(decl.softDelete).toBe(true);
    expect(decl.timestamps).toBe(true);
    expect(decl.version).toBe(true);
  });

  it('rejects unknown namespace', () => {
    const copy = { ...VALID, namespace: 'X' };
    const res = safeParseEntityDeclaration(copy);
    expect(res.ok).toBe(false);
  });

  it('rejects empty fields array', () => {
    const copy = { ...VALID, fields: [] };
    const res = safeParseEntityDeclaration(copy);
    expect(res.ok).toBe(false);
  });

  it('rejects missing audit.eventPrefix', () => {
    const copy = { ...VALID, audit: {} };
    const res = safeParseEntityDeclaration(copy);
    expect(res.ok).toBe(false);
  });

  it('rejects invalid field type', () => {
    const copy = {
      ...VALID,
      fields: [{ key: 'x', type: 'bogus' }],
    };
    const res = safeParseEntityDeclaration(copy);
    expect(res.ok).toBe(false);
  });

  it('accepts minimal declaration', () => {
    const minimal = {
      entity: 'foo',
      namespace: 'G',
      hashIdPrefix: 'FOO',
      table: 'foos',
      fields: [{ key: 'hashId', type: 'id' }],
      audit: { eventPrefix: 'svc.foo' },
    };
    const decl = parseEntityDeclaration(minimal);
    expect(decl.entity).toBe('foo');
  });

  it('reports readable error messages via safeParse', () => {
    const res = safeParseEntityDeclaration({ entity: 'x' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/namespace|table|hashIdPrefix/);
  });
});
