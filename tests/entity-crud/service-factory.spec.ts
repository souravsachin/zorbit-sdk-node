import {
  createEntityService,
  ConcurrencyConflictError,
  EntityNotFoundError,
  ValidationFailedError,
} from '../../src/entity-crud/service-factory';
import { parseEntityDeclaration } from '../../src/entity-crud/entity-schema';
import { parseQuery } from '../../src/entity-crud/filter-parser';

/**
 * In-memory repository that mimics the TypeORM Repository<T> methods we
 * use: findOne, findAndCount, create, save, remove.
 * Supports equality filters only (the service-factory tests don't
 * exercise TypeORM operators directly — those live in filter-parser
 * tests).
 */
function makeFakeRepo<T extends Record<string, any>>() {
  const rows: T[] = [];
  return {
    _rows: rows,
    create(obj: Partial<T>): T {
      return { ...obj } as T;
    },
    async save(obj: T): Promise<T> {
      // Upsert by hashId
      const idx = rows.findIndex((r) => r.hashId === obj.hashId);
      if (idx >= 0) {
        rows[idx] = { ...rows[idx]!, ...obj };
        return rows[idx]!;
      }
      rows.push(obj);
      return obj;
    },
    async remove(obj: T): Promise<void> {
      const idx = rows.findIndex((r) => r.hashId === obj.hashId);
      if (idx >= 0) rows.splice(idx, 1);
    },
    async findOne({ where }: any): Promise<T | null> {
      const match = rows.find((r) => matchesWhere(r, where));
      return match || null;
    },
    async findAndCount({ where, skip = 0, take = 25 }: any): Promise<[T[], number]> {
      const matched = rows.filter((r) => {
        if (Array.isArray(where)) {
          // OR case (search)
          return where.some((w) => matchesWhere(r, w));
        }
        return matchesWhere(r, where);
      });
      return [matched.slice(skip, skip + take), matched.length];
    },
  };
}

function matchesWhere<T extends Record<string, any>>(
  row: T,
  where: any,
): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    // Our notEqualsStub is { __not: value }
    if (typeof v === 'object' && v !== null && '__not' in (v as any)) {
      if (row[k] === (v as any).__not) return false;
      continue;
    }
    if (typeof v === 'object' && v !== null && typeof (v as any).type === 'string') {
      // TypeORM operator — fake repo doesn't simulate; treat as pass
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

const decl = parseEntityDeclaration({
  entity: 'user',
  namespace: 'O',
  hashIdPrefix: 'U',
  table: 'users',
  fields: [
    { key: 'hashId', type: 'id', readonly: true },
    { key: 'emailToken', type: 'email', required: true },
    { key: 'displayName', type: 'text', required: true },
    { key: 'organizationHashId', type: 'ref', refEntity: 'organization' },
    { key: 'role', type: 'enum', values: ['admin', 'user'] },
    { key: 'status', type: 'enum', values: ['active', 'deleted'], default: 'active' },
    { key: 'version', type: 'integer' },
  ],
  audit: { eventPrefix: 'identity.user', sensitiveFields: ['emailToken'] },
  search: { fields: ['displayName', 'emailToken'] },
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
  privileges: {
    read: 'identity.user.read',
    create: 'identity.user.manage',
    update: 'identity.user.manage',
    delete: 'identity.user.manage',
    export: 'identity.user.read',
  },
});

function makeSvc() {
  const repo = makeFakeRepo<any>();
  const svc = createEntityService({ declaration: decl, repository: repo as any });
  return { repo, svc };
}

describe('service-factory — create / list / findOne / update / remove', () => {
  it('creates a row with generated hashId and version=1', async () => {
    const { svc, repo } = makeSvc();
    const created: any = await svc.create(
      'O-42',
      { emailToken: 'a@b.com', displayName: 'Alice', status: 'active' },
      { userHashId: 'U-X', organizationHashId: 'O-42' },
    );
    expect(created.hashId).toMatch(/^U-[0-9A-F]{4}$/);
    expect(created.version).toBe(1);
    expect(repo._rows.length).toBe(1);
  });

  it('rejects create when required field missing', async () => {
    const { svc } = makeSvc();
    await expect(
      svc.create('O-42', { displayName: 'Alice' }, {
        userHashId: 'U-X',
        organizationHashId: 'O-42',
      }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('rejects create with invalid enum value', async () => {
    const { svc } = makeSvc();
    await expect(
      svc.create(
        'O-42',
        {
          emailToken: 'a@b.com',
          displayName: 'Alice',
          role: 'wizard',
        },
        { userHashId: 'U-X', organizationHashId: 'O-42' },
      ),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('rejects create with invalid email', async () => {
    const { svc } = makeSvc();
    await expect(
      svc.create(
        'O-42',
        { emailToken: 'not-an-email', displayName: 'Alice' },
        { userHashId: 'U-X', organizationHashId: 'O-42' },
      ),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('findOne returns masked email for low-priv user', async () => {
    const { svc } = makeSvc();
    const created: any = await svc.create(
      'O-42',
      {
        emailToken: 'alice@example.com',
        displayName: 'Alice',
        status: 'active',
      },
      { userHashId: 'U-X', organizationHashId: 'O-42' },
    );
    const read: any = await svc.findOne('O-42', created.hashId, {
      userHashId: 'U-Y',
      organizationHashId: 'O-42',
      role: 'user',
      privileges: [],
    });
    expect(read.emailToken).toBe('al***@example.com');
  });

  it('findOne returns unmasked email for high-priv user', async () => {
    const { svc } = makeSvc();
    const c: any = await svc.create(
      'O-42',
      {
        emailToken: 'alice@example.com',
        displayName: 'Alice',
        status: 'active',
      },
      { userHashId: 'U-X', organizationHashId: 'O-42' },
    );
    const read: any = await svc.findOne('O-42', c.hashId, {
      userHashId: 'U-Y',
      organizationHashId: 'O-42',
      role: 'user',
      privileges: ['identity.user.pii.view'],
    });
    expect(read.emailToken).toBe('alice@example.com');
  });

  it('findOne throws EntityNotFound when row absent', async () => {
    const { svc } = makeSvc();
    await expect(
      svc.findOne('O-42', 'U-NONE', {
        userHashId: 'U-X',
        organizationHashId: 'O-42',
      }),
    ).rejects.toBeInstanceOf(EntityNotFoundError);
  });

  it('list paginates + returns total', async () => {
    const { svc } = makeSvc();
    for (let i = 0; i < 5; i++) {
      await svc.create(
        'O-42',
        {
          emailToken: `u${i}@b.com`,
          displayName: `User ${i}`,
          status: 'active',
        },
        { userHashId: 'U-X', organizationHashId: 'O-42' },
      );
    }
    const result = await svc.list(
      'O-42',
      parseQuery({ page: 1, pageSize: 3 }),
      { userHashId: 'U-X', organizationHashId: 'O-42', role: 'user' },
    );
    expect(result.items).toHaveLength(3);
    expect(result.total).toBe(5);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(3);
  });

  it('update mutates fields + bumps version', async () => {
    const { svc } = makeSvc();
    const c: any = await svc.create(
      'O-42',
      { emailToken: 'a@b.com', displayName: 'Alice', status: 'active' },
      { userHashId: 'U-X', organizationHashId: 'O-42' },
    );
    const u: any = await svc.update(
      'O-42',
      c.hashId,
      { displayName: 'Alice Smith' },
      { userHashId: 'U-X', organizationHashId: 'O-42' },
    );
    expect(u.displayName).toBe('Alice Smith');
    expect(u.version).toBe(2);
  });

  it('update ignores readonly fields', async () => {
    const { svc } = makeSvc();
    const c: any = await svc.create(
      'O-42',
      { emailToken: 'a@b.com', displayName: 'Alice', status: 'active' },
      { userHashId: 'U-X', organizationHashId: 'O-42' },
    );
    const u: any = await svc.update(
      'O-42',
      c.hashId,
      { hashId: 'U-HACKED' },
      { userHashId: 'U-X', organizationHashId: 'O-42' },
    );
    expect(u.hashId).toBe(c.hashId);
  });

  it('soft-deletes by default', async () => {
    const { svc, repo } = makeSvc();
    const c: any = await svc.create(
      'O-42',
      { emailToken: 'a@b.com', displayName: 'Alice', status: 'active' },
      { userHashId: 'U-X', organizationHashId: 'O-42' },
    );
    await svc.remove('O-42', c.hashId, {
      userHashId: 'U-X',
      organizationHashId: 'O-42',
    });
    const row = repo._rows.find((r) => r.hashId === c.hashId);
    expect(row?.status).toBe('deleted');
  });

  it('exportCsv returns all rows (capped)', async () => {
    const { svc } = makeSvc();
    for (let i = 0; i < 3; i++) {
      await svc.create(
        'O-42',
        {
          emailToken: `u${i}@b.com`,
          displayName: `User ${i}`,
          status: 'active',
        },
        { userHashId: 'U-X', organizationHashId: 'O-42' },
      );
    }
    const rows = await svc.exportCsv(
      'O-42',
      parseQuery({ page: 1, pageSize: 1 }),
      { userHashId: 'U-X', organizationHashId: 'O-42', role: 'user' },
    );
    expect(rows.length).toBe(3);
  });
});

describe('service-factory — optimistic concurrency', () => {
  it('rejects stale If-Match with 409', async () => {
    const { svc } = makeSvc();
    const c: any = await svc.create(
      'O-42',
      { emailToken: 'a@b.com', displayName: 'Alice', status: 'active' },
      { userHashId: 'U-X', organizationHashId: 'O-42' },
    );
    await svc.update(
      'O-42',
      c.hashId,
      { displayName: 'Alice v2' },
      { userHashId: 'U-X', organizationHashId: 'O-42' },
    ); // version → 2

    await expect(
      svc.update(
        'O-42',
        c.hashId,
        { displayName: 'Alice v3' },
        { userHashId: 'U-X', organizationHashId: 'O-42' },
        { ifMatch: '1' },
      ),
    ).rejects.toBeInstanceOf(ConcurrencyConflictError);
  });

  it('accepts matching If-Match', async () => {
    const { svc } = makeSvc();
    const c: any = await svc.create(
      'O-42',
      { emailToken: 'a@b.com', displayName: 'Alice', status: 'active' },
      { userHashId: 'U-X', organizationHashId: 'O-42' },
    );
    const u: any = await svc.update(
      'O-42',
      c.hashId,
      { displayName: 'Alice v2' },
      { userHashId: 'U-X', organizationHashId: 'O-42' },
      { ifMatch: '1' },
    );
    expect(u.version).toBe(2);
  });

  it('ignores ifMatch when undefined', async () => {
    const { svc } = makeSvc();
    const c: any = await svc.create(
      'O-42',
      { emailToken: 'a@b.com', displayName: 'Alice', status: 'active' },
      { userHashId: 'U-X', organizationHashId: 'O-42' },
    );
    const u: any = await svc.update(
      'O-42',
      c.hashId,
      { displayName: 'Alice v2' },
      { userHashId: 'U-X', organizationHashId: 'O-42' },
    );
    expect(u.version).toBe(2);
  });

  it('409 payload carries currentVersion', async () => {
    const { svc } = makeSvc();
    const c: any = await svc.create(
      'O-42',
      { emailToken: 'a@b.com', displayName: 'Alice', status: 'active' },
      { userHashId: 'U-X', organizationHashId: 'O-42' },
    );
    try {
      await svc.update(
        'O-42',
        c.hashId,
        { displayName: 'X' },
        { userHashId: 'U-X', organizationHashId: 'O-42' },
        { ifMatch: '99' },
      );
      fail('expected conflict');
    } catch (e) {
      if (e instanceof ConcurrencyConflictError) {
        expect(e.currentVersion).toBe(1);
      } else {
        throw e;
      }
    }
  });
});

describe('service-factory — audit publisher integration', () => {
  it('publishes audit events on create/update/delete', async () => {
    const repo = makeFakeRepo<any>();
    const published: any[] = [];
    const publisher: any = {
      publish: async (t: string, ns: string, nsId: string, p: any) =>
        published.push({ t, ns, nsId, p }),
    };
    const svc = createEntityService({
      declaration: decl,
      repository: repo as any,
      auditPublisher: publisher,
    });
    const actor = { userHashId: 'U-X', organizationHashId: 'O-42' };
    const c: any = await svc.create(
      'O-42',
      { emailToken: 'a@b.com', displayName: 'Alice', status: 'active' },
      actor,
    );
    await svc.update(
      'O-42',
      c.hashId,
      { displayName: 'A2' },
      actor,
    );
    await svc.remove('O-42', c.hashId, actor);
    expect(published.map((e) => e.t)).toEqual([
      'identity.user.created',
      'identity.user.updated',
      'identity.user.deleted',
    ]);
    // Sensitive field is masked in all events
    for (const e of published) {
      if (e.p.before?.emailToken !== undefined) {
        expect(e.p.before.emailToken).toBe('[REDACTED]');
      }
      if (e.p.after?.emailToken !== undefined) {
        expect(e.p.after.emailToken).toBe('[REDACTED]');
      }
    }
  });
});
