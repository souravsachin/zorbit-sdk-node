# ENTITY-CRUD DI Fix (task #109) — `undefinedRepository` Root Cause + Migration

_Applies to `@zorbit-platform/sdk-node` 0.2.2 and later._

## Symptom

When a module imported

```ts
ZorbitEntityCrudModule.register({ declarations, entityMap, moduleSlug })
```

NestJS boot threw:

```
Nest can't resolve dependencies of the Symbol(ZorbitCrudService:<entity>)
(?). Please make sure that the argument undefinedRepository at index [0]
is available in the ZorbitEntityCrudModule context.
```

That literal string `undefinedRepository` was the smoking gun — NestJS
was trying to inject the literal token string `undefinedRepository`
instead of a proper `Repository<T>` token.

## Root cause

The SDK declared `@nestjs/common`, `@nestjs/core`, `@nestjs/typeorm`,
`typeorm`, and `reflect-metadata` correctly as `peerDependencies` (so
consumers supply them). **However**, the SDK repo also lists those same
packages under `devDependencies` so `tsc` + `jest` can run. The SDK's
own `npm install` puts them into `zorbit-sdk-node/node_modules/`.

When a consumer installs the SDK via a `file:` reference (which is the
default in the Zorbit monorepo — see every `"@zorbit-platform/sdk-node":
"file:../zorbit-sdk-node"` entry), npm **symlinks** the SDK directory
into the consumer's `node_modules/@zorbit-platform/sdk-node`.

Node's module resolution walks the **real path** of the symlink target,
not the symlink path. So when SDK code does

```ts
import { getRepositoryToken } from '@nestjs/typeorm';
```

Node starts from `<sdk-real-path>/src/...`, walks UP, and finds
`<sdk-real-path>/node_modules/@nestjs/typeorm` **before** it reaches the
consumer's `<consumer>/node_modules/@nestjs/typeorm`.

The result: two distinct copies of `@nestjs/typeorm` (and two distinct
copies of `typeorm`) loaded in the same process.

`@nestjs/typeorm`'s `getRepositoryToken(Entity)` returns a symbol keyed
off an internal `ENTITIES_METADATA` Map. Because the SDK's copy and the
consumer's copy each have their own Map, the token the SDK emits
`{ provide: token, ... }` and the token the consumer's
`TypeOrmModule.forFeature([Entity])` registers **do not match**. Worse,
the internal `getEntityManager` lookup fails silently and the returned
token stringifies to `undefinedRepository`.

Nest's DI container then tries to resolve an injector whose name is
literally the string `undefinedRepository`. It fails. Boot dies.

### Earlier workaround

Several modules (payment_gateway, medical_coding, mi_quotation) papered
over the bug by:

- Writing a thin `DataSource.query()`-based custom controller instead of
  the declarative CRUD factory (~190 LOC per module)
- Manually running `rm -rf node_modules/@zorbit-platform/sdk-node/node_modules`
  as part of the module's install/build step

Both are brittle — the first throws away Nest's typed Repository, audit
hooks, masking, and filter parsing; the second resurfaces every time
`npm ci` runs.

## Fix (option A — peerDependencies + post-install prune)

Shipped in `0.2.2`:

1. `@nestjs/common`, `@nestjs/core`, `@nestjs/typeorm`, `@nestjs/config`,
   `@nestjs/passport`, `passport`, `passport-jwt`, `reflect-metadata`,
   `rxjs`, and `typeorm` are declared as `peerDependencies` (with
   `peerDependenciesMeta.*.optional = true` — NestJS services only
   depend on the subset they need).
2. The SDK keeps a **minimal `devDependencies`** mirror so `tsc` and
   `jest` can still run inside the SDK repo.
3. A new **post-install script** — `scripts/prune-peer-deps.js` — runs
   on every `npm install`. It:
   - Detects whether the SDK is installed in the consumer's
     `node_modules/@zorbit-platform/sdk-node/` (nested install) or at
     the SDK repo root (development).
   - In the nested case it **deletes** every peer-dep directory from
     the SDK's own `node_modules/`. The SDK's compiled `dist/` doesn't
     need them — `import '@nestjs/typeorm'` is resolved by walking UP
     to the consumer's `node_modules`.
   - In the SDK repo case it leaves `node_modules/` untouched so tests
     and `tsc` continue to work.
4. `bundledDependencies` is explicitly set to `[]` and `files` is
   declared so only `dist/` + the prune script get published.
5. Regression unit tests (`src/entity-crud/__tests__/di-regression.spec.ts`)
   assert that
   - `ZorbitEntityCrudModule.register()` returns a DynamicModule with
     `TypeOrmModule.forFeature()` imports,
   - the provider's `inject` token is the very same object that
     `getRepositoryToken(entity)` returns,
   - controller path metadata is correct,
   - `getRepositoryToken()` never stringifies to `undefinedRepository`.

The first three items address the root cause; items 4–5 prevent future
regressions.

### Why not the other options?

| Option | Verdict | Why |
|---|---|---|
| A — peer deps + post-install prune | **Shipped** | Works with `file:` + symlink installs. Zero consumer boilerplate. |
| B — `registerAsync()` with factory | Deferred | Moves the DI wiring into every consumer. Verbose. Doesn't fix the root cause — two TypeORM copies would still produce two token symbols. |
| C — `EntitySchema` instead of decorated classes | Orthogonal | Already the pattern in `zmb_factory`'s `src/templates/backend-app/entities.ts`. Useful independently, but doesn't fix decorated-class consumers. |

## Migration guide — existing consumers

If your module was carrying the `DataSource.query()` workaround:

1. Add the SDK's declarative CRUD module to your `app.module.ts`:

   ```ts
   import {
     ZorbitEntityCrudModule,
   } from '@zorbit-platform/sdk-node';

   @Module({
     imports: [
       // ... existing ConfigModule, PassportModule, TypeOrmModule.forRootAsync
       TypeOrmModule.forFeature(entityClasses),
       ZorbitEntityCrudModule.register({
         declarations,
         entityMap,
         moduleSlug: '<your-slug>',
       }),
     ],
   })
   export class AppModule {}
   ```

   The `TypeOrmModule.forFeature(entityClasses)` at the root module is
   deliberate — it declares the repos at a level where both the CRUD
   factory AND any surviving hand-written controllers can inject them.

2. Delete any thin custom controller whose sole job was
   `DataSource.query('SELECT ...')`.

3. Keep custom controllers that do **non-CRUD** work (fuzzy search,
   mock sandbox submission, etc.). Move their TypeORM dependency to
   `@InjectRepository()` if they still need DB access — or leave
   `@InjectDataSource()` alone for ad-hoc SQL.

4. Remove any `rm -rf node_modules/@zorbit-platform/sdk-node/node_modules`
   hack from your Dockerfile / install scripts. The SDK's postinstall
   now handles it.

5. Re-install:

   ```bash
   rm -rf node_modules package-lock.json
   npm install
   npm run build
   npm test
   ```

6. Verify routes:

   ```bash
   npx nest start &
   curl -s http://localhost:<port>/<slug>/api/v1/<ns>/<scope>/<resource> \
     -H "authorization: Bearer <jwt>"
   ```

   The CRUD factory generates `GET / POST / GET :id / PUT :id /
   DELETE :id / GET export` for every entity declared in
   `entities/*.entity.json`.

## Reference — repos remediated on 0.2.2 rollout

| Repo | Workaround before | After | LOC removed |
|---|---|---|---|
| `zorbit-pfs-payment_gateway` | `custom.controller.ts` with 6 endpoints on DataSource.query(), 265 LOC | `ZorbitEntityCrudModule.register()` + custom controller kept ONLY for mock attempt POST | see commit |
| `zorbit-pfs-medical_coding` | `custom.controller.ts` with 5 endpoints on DataSource.query(), 167 LOC | `ZorbitEntityCrudModule.register()` + custom controller kept ONLY for fuzzy `searches` endpoint | see commit |
| `zorbit-app-mi_quotation` | already using `ZorbitEntityCrudModule.register()` (discovered during review — no further changes beyond refreshing `node_modules`) | same | 0 |

## Verification checklist

After applying 0.2.2 in a consumer:

- [ ] `npm ci && npm run build` succeeds with zero errors.
- [ ] `ls node_modules/@zorbit-platform/sdk-node/node_modules/@nestjs 2>/dev/null`
      returns nothing (pruned).
- [ ] `npm test` runs with no DI-related failures.
- [ ] Booting the service logs `Mounted CRUD for "<entity>" under
      /<slug>/api/v1/<ns>/.../<resource>` once per declared entity.
- [ ] Hitting any generated route with a valid JWT returns 200 OK, not
      500 with `undefinedRepository` in the stack trace.

## Files

- `package.json` — peer deps, `bundledDependencies: []`, `files`, `postinstall`, version `0.2.2`
- `scripts/prune-peer-deps.js` — idempotent prune script, NEW
- `src/entity-crud/__tests__/di-regression.spec.ts` — 10-case regression suite, NEW
- `src/entity-crud/entity-crud.module.ts` — unchanged (the factory was always correct)
- `ENTITY-CRUD-DI-FIX.md` — this file
