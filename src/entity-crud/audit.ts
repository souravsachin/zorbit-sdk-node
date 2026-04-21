/**
 * Audit helper used by the CRUD factory.
 *
 * Wraps the SDK's generic `AuditEventPublisher` so the factory only
 * has to call `emitAudit(op, ...)` — envelope construction,
 * sensitive-field masking, and non-fatal publish semantics live here.
 */
import { AuditEventPublisher } from '../audit/event-publisher';
import type { EntityDeclaration } from './entity-schema';

export type CrudOp = 'created' | 'updated' | 'deleted' | 'restored';

export interface EmitAuditOptions {
  publisher?: AuditEventPublisher;
  declaration: EntityDeclaration;
  op: CrudOp;
  actor: { userHashId: string; organizationHashId: string };
  hashId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  namespaceId?: string;
}

/**
 * Redact declaration-flagged sensitive fields from an audit payload.
 */
export function redactSensitive(
  row: Record<string, unknown> | null | undefined,
  sensitive: string[] | undefined,
): Record<string, unknown> | null {
  if (!row) return null;
  if (!sensitive || sensitive.length === 0) return { ...row };
  const out: Record<string, unknown> = { ...row };
  for (const f of sensitive) {
    if (f in out) out[f] = '[REDACTED]';
  }
  return out;
}

/**
 * Shallow diff — list of changed field names (no values).
 */
export function diffFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): string[] {
  const keys = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);
  const changed: string[] = [];
  for (const k of keys) {
    const b = before?.[k];
    const a = after?.[k];
    if (JSON.stringify(b) !== JSON.stringify(a)) changed.push(k);
  }
  return changed;
}

/**
 * Emit a single audit event for a CRUD mutation. Never throws —
 * publishing failures are logged by the underlying publisher and
 * swallowed (see `AuditEventPublisher` contract).
 */
export async function emitAudit(opts: EmitAuditOptions): Promise<void> {
  if (!opts.publisher) return;
  const sensitive = opts.declaration.audit.sensitiveFields;
  const eventType = `${opts.declaration.audit.eventPrefix}.${opts.op}`;
  const namespace = opts.declaration.namespace;
  const namespaceId =
    opts.namespaceId ||
    opts.actor.organizationHashId ||
    'G';
  const payload = {
    entity: opts.declaration.entity,
    hashId: opts.hashId,
    actor: opts.actor,
    before: redactSensitive(opts.before, sensitive),
    after: redactSensitive(opts.after, sensitive),
    changedFields: diffFields(opts.before, opts.after),
  };
  try {
    await opts.publisher.publish(eventType, namespace, namespaceId, payload);
  } catch {
    // publisher already swallows; this is belt-and-braces.
  }
}
