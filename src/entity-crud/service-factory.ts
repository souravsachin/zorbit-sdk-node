/**
 * Service factory — a generic CRUD service built on top of a TypeORM
 * `Repository<T>`.
 *
 * The factory is stateless: callers construct one per (repository,
 * declaration) pair and call `.list() / .findOne() / ...`. The resulting
 * class is consumed by `controller-factory.ts` which mounts Nest
 * controllers against it.
 *
 * Not a `@Injectable()` class — we wire dependencies manually in
 * `ZorbitEntityCrudModule` because the declarations drive provider
 * naming.
 */
import type { Repository } from 'typeorm';
// Lazy typeorm runtime import: loaded only when entity-crud features are actually
// invoked. Top-level eager `import { In, Like, ... } from 'typeorm'` caused every
// consumer that does `require('@zorbit-platform/sdk-node')` to hit
// `Cannot find module 'typeorm'` even when they don't use entity-crud.
// (Cycle 105 — VM 110 PM2 crash-loop fix, 2026-04-26.)
let _typeormOps: any | null = null;
function tormOps(): any {
  if (!_typeormOps) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _typeormOps = require('typeorm');
  }
  return _typeormOps;
}
const In = (...args: any[]) => tormOps().In(...args);
const Like = (...args: any[]) => tormOps().Like(...args);
const Between = (...args: any[]) => tormOps().Between(...args);
const MoreThanOrEqual = (...args: any[]) => tormOps().MoreThanOrEqual(...args);
const LessThanOrEqual = (...args: any[]) => tormOps().LessThanOrEqual(...args);
const Not = (...args: any[]) => tormOps().Not(...args);
import type { EntityDeclaration } from './entity-schema';
import { generateHashId } from '../utils/hash-id';
import type { ParsedQuery, FilterShape } from './filter-parser';
import { maskRows } from './masking';
import type { MaskingContext } from './masking';
import { emitAudit, CrudOp } from './audit';
import type { AuditEventPublisher } from '../audit/event-publisher';

export interface CrudActor {
  userHashId: string;
  organizationHashId: string;
  role?: string | null;
  privileges?: string[];
}

export interface ListResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ConcurrencyCheck {
  /** Caller-supplied If-Match header value (integer) or undefined */
  ifMatch?: string | number;
}

export class ConcurrencyConflictError extends Error {
  readonly statusCode = 409;
  readonly currentVersion: number;
  constructor(current: number) {
    super('Optimistic concurrency conflict');
    this.currentVersion = current;
  }
}

export class EntityNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(entity: string, hashId: string) {
    super(`${entity} ${hashId} not found`);
  }
}

export class ValidationFailedError extends Error {
  readonly statusCode = 400;
  constructor(msg: string) {
    super(msg);
  }
}

/**
 * Config a factory-built service needs.
 */
export interface EntityServiceConfig<T extends Record<string, unknown>> {
  declaration: EntityDeclaration;
  repository: Repository<T>;
  auditPublisher?: AuditEventPublisher;
  /** Field key that holds the scope id (default: `organizationHashId` for O, etc) */
  scopeField?: string;
  /** Field key that holds the hash id (default: `hashId`) */
  hashIdField?: string;
}

/**
 * Build a generic CRUD service from a declaration + repository pair.
 */
export function createEntityService<
  T extends Record<string, unknown>,
>(cfg: EntityServiceConfig<T>) {
  const hashIdField = cfg.hashIdField || 'hashId';
  const scopeField = cfg.scopeField || defaultScopeField(cfg.declaration);
  const softDelete = cfg.declaration.softDelete;

  function toMaskingCtx(actor: CrudActor): MaskingContext {
    const ctx: MaskingContext = {};
    if (actor.role !== undefined) ctx.role = actor.role;
    if (actor.privileges !== undefined) ctx.privileges = actor.privileges;
    return ctx;
  }

  async function list(
    scopeId: string,
    query: ParsedQuery,
    actor: CrudActor,
  ): Promise<ListResult<T>> {
    const where: Record<string, unknown> = {};
    if (scopeField && cfg.declaration.namespace !== 'G') {
      where[scopeField] = scopeId;
    }
    if (softDelete) {
      // Exclude soft-deleted rows by default. Only applies when the
      // entity has a `status` field with a `deleted` value — otherwise
      // we leave the where clause alone (the repo probably implements
      // a different soft-delete convention).
      const hasDeletedStatus = cfg.declaration.fields.some(
        (f) => f.key === 'status' && f.type === 'enum' && f.values?.includes('deleted'),
      );
      if (hasDeletedStatus && where.status === undefined) {
        where.status = Not('deleted');
      }
    }

    for (const [f, shape] of Object.entries(query.filters)) {
      where[f] = filterShapeToTypeOrm(shape);
    }

    if (query.q && cfg.declaration.search?.fields?.length) {
      // Build an OR-style search by duplicating the query into each
      // search field. Fallback to a single field if repository doesn't
      // support array-where (consumer can override via customHandlers).
      const fields = cfg.declaration.search.fields;
      const q = `%${query.q}%`;
      const orWhere = fields.map((f) => ({ ...where, [f]: Like(q) }));
      const [items, total] = await (cfg.repository as any).findAndCount({
        where: orWhere,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        order: query.sort
          ? { [query.sort]: query.order.toUpperCase() }
          : { [hashIdField]: 'DESC' },
      });
      return {
        items: maskRows(
          items as Array<Record<string, unknown>>,
          cfg.declaration.masking?.rules || [],
          toMaskingCtx(actor),
        ) as T[],
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    }

    const [items, total] = await (cfg.repository as any).findAndCount({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      order: query.sort
        ? { [query.sort]: query.order.toUpperCase() }
        : { [hashIdField]: 'DESC' },
    });
    return {
      items: maskRows(
        items as Array<Record<string, unknown>>,
        cfg.declaration.masking?.rules || [],
        toMaskingCtx(actor),
      ) as T[],
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async function findOne(
    scopeId: string,
    hashId: string,
    actor: CrudActor,
  ): Promise<T> {
    const where: Record<string, unknown> = { [hashIdField]: hashId };
    if (scopeField && cfg.declaration.namespace !== 'G') {
      where[scopeField] = scopeId;
    }
    const row = (await (cfg.repository as any).findOne({ where })) as T | null;
    if (!row) {
      throw new EntityNotFoundError(cfg.declaration.entity, hashId);
    }
    const [masked] = maskRows(
      [row as Record<string, unknown>],
      cfg.declaration.masking?.rules || [],
      toMaskingCtx(actor),
    );
    return masked as T;
  }

  async function create(
    scopeId: string,
    dto: Record<string, unknown>,
    actor: CrudActor,
  ): Promise<T> {
    validateDto(cfg.declaration, dto, 'create');

    const row: Record<string, unknown> = { ...dto };
    row[hashIdField] = row[hashIdField] || generateHashId(
      cfg.declaration.hashIdPrefix,
    );
    if (scopeField && cfg.declaration.namespace !== 'G') {
      row[scopeField] = row[scopeField] || scopeId;
    }
    if (cfg.declaration.version) {
      row.version = 1;
    }

    const created = (cfg.repository as any).create(row);
    const saved = await (cfg.repository as any).save(created);

    await emitAudit({
      declaration: cfg.declaration,
      ...(cfg.auditPublisher ? { publisher: cfg.auditPublisher } : {}),
      op: 'created' as CrudOp,
      actor,
      hashId: (saved as any)[hashIdField] as string,
      after: saved as Record<string, unknown>,
      ...(scopeId ? { namespaceId: scopeId } : {}),
    });

    return saved as T;
  }

  async function update(
    scopeId: string,
    hashId: string,
    patch: Record<string, unknown>,
    actor: CrudActor,
    concurrency?: ConcurrencyCheck,
  ): Promise<T> {
    validateDto(cfg.declaration, patch, 'update');

    const where: Record<string, unknown> = { [hashIdField]: hashId };
    if (scopeField && cfg.declaration.namespace !== 'G') {
      where[scopeField] = scopeId;
    }
    const existing = (await (cfg.repository as any).findOne({ where })) as T | null;
    if (!existing) {
      throw new EntityNotFoundError(cfg.declaration.entity, hashId);
    }

    if (cfg.declaration.version && concurrency?.ifMatch !== undefined) {
      const current = Number((existing as any).version || 0);
      const expected = Number(concurrency.ifMatch);
      if (Number.isFinite(expected) && expected !== current) {
        throw new ConcurrencyConflictError(current);
      }
    }

    const before = { ...(existing as Record<string, unknown>) };
    const readOnlyKeys = new Set(
      cfg.declaration.fields.filter((f) => f.readonly).map((f) => f.key),
    );
    for (const [k, v] of Object.entries(patch)) {
      if (readOnlyKeys.has(k)) continue;
      if (k === 'version') continue;
      (existing as any)[k] = v;
    }
    if (cfg.declaration.version) {
      (existing as any).version = Number((existing as any).version || 0) + 1;
    }

    const saved = await (cfg.repository as any).save(existing as any);

    await emitAudit({
      declaration: cfg.declaration,
      ...(cfg.auditPublisher ? { publisher: cfg.auditPublisher } : {}),
      op: 'updated' as CrudOp,
      actor,
      hashId,
      before,
      after: saved as Record<string, unknown>,
      ...(scopeId ? { namespaceId: scopeId } : {}),
    });

    return saved as T;
  }

  async function remove(
    scopeId: string,
    hashId: string,
    actor: CrudActor,
  ): Promise<void> {
    const where: Record<string, unknown> = { [hashIdField]: hashId };
    if (scopeField && cfg.declaration.namespace !== 'G') {
      where[scopeField] = scopeId;
    }
    const existing = (await (cfg.repository as any).findOne({ where })) as T | null;
    if (!existing) {
      throw new EntityNotFoundError(cfg.declaration.entity, hashId);
    }

    if (cfg.declaration.softDelete) {
      (existing as any).status = 'deleted';
      if (cfg.declaration.version) {
        (existing as any).version =
          Number((existing as any).version || 0) + 1;
      }
      await (cfg.repository as any).save(existing as any);
    } else {
      await (cfg.repository as any).remove(existing as any);
    }

    await emitAudit({
      declaration: cfg.declaration,
      ...(cfg.auditPublisher ? { publisher: cfg.auditPublisher } : {}),
      op: 'deleted' as CrudOp,
      actor,
      hashId,
      before: existing as Record<string, unknown>,
      ...(scopeId ? { namespaceId: scopeId } : {}),
    });
  }

  async function exportCsv(
    scopeId: string,
    query: ParsedQuery,
    actor: CrudActor,
  ): Promise<T[]> {
    // Reuse list() but bypass pagination — cap at 10k to avoid OOM.
    const bigQuery: ParsedQuery = {
      ...query,
      page: 1,
      pageSize: Math.min(10_000, Math.max(query.pageSize, 1_000)),
    };
    const result = await list(scopeId, bigQuery, actor);
    return result.items;
  }

  return {
    list,
    findOne,
    create,
    update,
    remove,
    exportCsv,
    declaration: cfg.declaration,
  };
}

// ---- helpers ----

function defaultScopeField(decl: EntityDeclaration): string | undefined {
  switch (decl.namespace) {
    case 'O':
      return 'organizationHashId';
    case 'D':
      return 'departmentHashId';
    case 'U':
      return 'userHashId';
    case 'G':
    default:
      return undefined;
  }
}

function filterShapeToTypeOrm(shape: FilterShape): unknown {
  if ('eq' in shape) return shape.eq;
  if ('in' in shape) return In(shape.in);
  // range
  const { from, to } = shape as { from?: string; to?: string };
  if (from && to) return Between(from, to);
  if (from) return MoreThanOrEqual(from);
  if (to) return LessThanOrEqual(to);
  return undefined;
}

/**
 * Minimal validation — required fields + enum membership. Full schema
 * validation is handled by Zod at boot; per-request validation stays
 * lightweight.
 */
function validateDto(
  decl: EntityDeclaration,
  dto: Record<string, unknown>,
  mode: 'create' | 'update',
): void {
  for (const f of decl.fields) {
    if (f.readonly) continue;
    const val = dto[f.key];
    if (mode === 'create' && f.required && (val === undefined || val === null)) {
      // skip if field has a default
      if (f.default !== undefined) continue;
      throw new ValidationFailedError(`Missing required field: ${f.key}`);
    }
    if (val !== undefined && val !== null && f.type === 'enum' && f.values) {
      if (!f.values.includes(String(val))) {
        throw new ValidationFailedError(
          `Invalid value for ${f.key}: ${String(val)}. Allowed: ${f.values.join(',')}`,
        );
      }
    }
    if (
      val !== undefined &&
      val !== null &&
      f.type === 'email' &&
      typeof val === 'string'
    ) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val)) {
        throw new ValidationFailedError(`Invalid email: ${f.key}`);
      }
    }
  }
}
