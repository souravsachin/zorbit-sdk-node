/**
 * DI regression — Entity CRUD module.
 *
 * Guards against the bug that forced payment_gateway, medical_coding, and
 * mi_quotation to write thin hand-rolled controllers with DataSource.query()
 * instead of using the declarative SDK:
 *
 *   "undefinedRepository" error at boot — NestJS DI could not resolve the
 *   Repository<Entity> token because two copies of @nestjs/typeorm +
 *   typeorm were loaded (one from SDK's nested node_modules/, one from the
 *   consumer's top-level). getRepositoryToken() in each produced a
 *   different symbol.
 *
 * Root fix — SDK's peerDependencies are now enforced and the SDK's
 * postinstall prune script removes peer-dep copies from its own
 * node_modules when it's installed into a consumer. See
 * ENTITY-CRUD-DI-FIX.md.
 *
 * These tests pin down the SDK-side invariants that must hold for the fix
 * to stay valid. They do NOT spin up Postgres or a real TypeORM
 * DataSource — that belongs in an integration test per consumer repo.
 */
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { EntitySchema } from 'typeorm';
import { ZorbitEntityCrudModule } from '../entity-crud.module';
import { parseEntityDeclaration } from '../entity-schema';

// Minimal runtime entity — the SDK accepts both decorated classes and
// EntitySchema. EntitySchema is a plain constructor-free descriptor, so
// we can use it in unit tests without the reflect-metadata machinery.
const DummyEntity = new EntitySchema({
  name: 'dummy',
  tableName: 'dummies',
  columns: {
    hashId: { primary: true, type: 'varchar', length: 20 },
    label: { type: 'varchar', length: 200 },
  },
});

const DUMMY_DECL = parseEntityDeclaration({
  $schema: 'https://zorbit.onezippy.ai/schemas/entity-v1.json',
  entity: 'dummy',
  displayName: 'Dummy',
  namespace: 'O',
  hashIdPrefix: 'D',
  table: 'dummies',
  softDelete: false,
  timestamps: false,
  version: false,
  fields: [
    { key: 'hashId', type: 'id', readonly: true },
    { key: 'label', type: 'text', required: true, maxLength: 200 },
  ],
  indexes: [],
  privileges: {
    read: 'dummy.read',
    create: 'dummy.manage',
    update: 'dummy.manage',
    delete: 'dummy.manage',
    export: 'dummy.read',
  },
  audit: {
    eventPrefix: 'dummy',
    sensitiveFields: [],
  },
});

describe('ZorbitEntityCrudModule — DI regression (task #109)', () => {
  it('compiles register() without throwing when given a declaration + entityMap', () => {
    expect(() =>
      ZorbitEntityCrudModule.register({
        declarations: [DUMMY_DECL],
        entityMap: { dummy: DummyEntity },
        moduleSlug: 'test',
      }),
    ).not.toThrow();
  });

  it('produces a DynamicModule with a TypeOrmModule.forFeature import', () => {
    const dm = ZorbitEntityCrudModule.register({
      declarations: [DUMMY_DECL],
      entityMap: { dummy: DummyEntity },
      moduleSlug: 'test',
    });
    expect(dm.module).toBe(ZorbitEntityCrudModule);
    expect(dm.imports).toBeDefined();
    expect(Array.isArray(dm.imports)).toBe(true);
    expect(dm.imports!.length).toBeGreaterThan(0);
    // The first import must be a TypeOrmModule.forFeature() dynamic module.
    const first: any = dm.imports![0];
    expect(first.module).toBe(TypeOrmModule);
  });

  it('emits a provider whose inject token matches getRepositoryToken(entity)', () => {
    // This is the heart of the regression: the SDK must inject the SAME
    // token that TypeOrmModule.forFeature([DummyEntity]) registers. If
    // the test runner had two copies of @nestjs/typeorm loaded, these
    // tokens would diverge and Nest would throw "undefinedRepository".
    const dm = ZorbitEntityCrudModule.register({
      declarations: [DUMMY_DECL],
      entityMap: { dummy: DummyEntity },
      moduleSlug: 'test',
    });
    const expectedRepoToken = getRepositoryToken(DummyEntity);
    expect(expectedRepoToken).toBeDefined();
    // The token returned by @nestjs/typeorm must NOT stringify to the
    // sentinel literal that appeared when two module copies were loaded.
    expect(String(expectedRepoToken)).not.toBe('undefinedRepository');

    const providers = dm.providers as any[];
    expect(providers.length).toBeGreaterThan(0);
    const crudProvider = providers.find(
      (p) => p && typeof p === 'object' && 'inject' in p && 'useFactory' in p,
    );
    expect(crudProvider).toBeDefined();
    expect(crudProvider.inject).toBeDefined();
    expect(crudProvider.inject.length).toBe(1);
    // The inject token MUST be the very same symbol that
    // getRepositoryToken(entityClass) returned — if it were a different
    // Repository<T> token (because of a duplicated @nestjs/typeorm), Nest
    // would be unable to wire the repo and boot would fail.
    expect(crudProvider.inject[0]).toBe(expectedRepoToken);
  });

  it('produces one controller per declaration', () => {
    const dm = ZorbitEntityCrudModule.register({
      declarations: [DUMMY_DECL],
      entityMap: { dummy: DummyEntity },
      moduleSlug: 'test',
    });
    expect(dm.controllers).toBeDefined();
    expect(Array.isArray(dm.controllers)).toBe(true);
    expect(dm.controllers!.length).toBe(1);
    // The controller is a class — it must be a function.
    expect(typeof dm.controllers![0]).toBe('function');
  });

  it('mounts CRUD routes at /<moduleSlug>/api/v1/<namespace>/... — path metadata', () => {
    const dm = ZorbitEntityCrudModule.register({
      declarations: [DUMMY_DECL],
      entityMap: { dummy: DummyEntity },
      moduleSlug: 'test',
    });
    const ControllerClass = dm.controllers![0]! as any;
    // Nest stores the @Controller(path) value on the class via
    // reflect-metadata under the `path` key.
    const path = Reflect.getMetadata('path', ControllerClass);
    expect(typeof path).toBe('string');
    // DUMMY_DECL.entity === 'dummy' → resource slug === 'dummys'; namespace
    // 'O' → path param ':orgId'. moduleSlug 'test' is the top-level
    // prefix.
    expect(path).toContain('test');
    expect(path).toContain('api/v1');
    expect(path).toContain(':orgId');
    expect(path).toContain('dummys');
  });

  it('registers no providers/controllers when declarations are empty', () => {
    const dm = ZorbitEntityCrudModule.register({
      declarations: [],
      entityMap: {},
    });
    expect(dm.controllers).toEqual([]);
    expect(dm.providers).toEqual([]);
    expect(dm.imports).toEqual([]);
  });

  it('skips (and does not crash) when a declaration has no entityMap entry', () => {
    expect(() =>
      ZorbitEntityCrudModule.register({
        declarations: [DUMMY_DECL],
        entityMap: {}, // intentionally empty
        moduleSlug: 'test',
      }),
    ).not.toThrow();
    const dm = ZorbitEntityCrudModule.register({
      declarations: [DUMMY_DECL],
      entityMap: {},
    });
    expect(dm.controllers).toEqual([]);
    expect(dm.providers).toEqual([]);
  });

  it('throws when failFast=true and a declaration has no entityMap entry', () => {
    expect(() =>
      ZorbitEntityCrudModule.register({
        declarations: [DUMMY_DECL],
        entityMap: {},
        failFast: true,
      }),
    ).toThrow(/Missing entityMap/);
  });
});

describe('ZorbitEntityCrudModule — peer-dep invariants', () => {
  it('@nestjs/typeorm getRepositoryToken is resolvable (peer-dep present)', () => {
    // Guards against the package.json being edited to move @nestjs/typeorm
    // out of peerDependencies in a way that breaks consumption.
    expect(typeof getRepositoryToken).toBe('function');
    const tok = getRepositoryToken(DummyEntity);
    expect(tok).toBeDefined();
    // Should stringify to something like 'DummyRepository' — NOT the
    // literal 'undefinedRepository' sentinel the bug produced.
    expect(String(tok)).not.toMatch(/^undefined/);
  });

  it('typeorm EntitySchema is a construct-able shape (peer-dep present)', () => {
    expect(typeof EntitySchema).toBe('function');
    const schema = new EntitySchema({
      name: 'x',
      columns: { id: { primary: true, type: 'varchar' } },
    });
    expect(schema).toBeDefined();
    expect((schema as any).options.name).toBe('x');
  });
});
