/**
 * Zod schema for the entity-v1 declaration format.
 *
 * An entity declaration is a sidecar JSON file a module ships at
 * `<repo>/entities/<slug>.entity.json`. The SDK loads every such file at
 * boot and generates a full CRUD controller + service.
 *
 * See `/Users/s/workspace/zorbit/00_docs/platform/SPEC-entity-crud.md`.
 */
import { z } from 'zod';

export const NamespaceEnum = z.enum(['G', 'O', 'D', 'U']);
export type EntityNamespace = z.infer<typeof NamespaceEnum>;

export const FieldTypeEnum = z.enum([
  'id',
  'text',
  'longtext',
  'number',
  'integer',
  'boolean',
  'date',
  'datetime',
  'timestamp',
  'email',
  'url',
  'enum',
  'ref',
  'json',
  'jsonb',
  'secret',
  'pii',
]);
export type EntityFieldType = z.infer<typeof FieldTypeEnum>;

export const FieldSchema = z.object({
  key: z.string().min(1),
  type: FieldTypeEnum,
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
  readonly: z.boolean().optional(),
  maxLength: z.number().int().positive().optional(),
  minLength: z.number().int().nonnegative().optional(),
  default: z.unknown().optional(),
  values: z.array(z.string()).optional(),
  refEntity: z.string().optional(),
  description: z.string().optional(),
  /** For `pii` / `pii.<kind>` — the PII kind (email, phone, name, ...) */
  piiKind: z.string().optional(),
});
export type EntityField = z.infer<typeof FieldSchema>;

export const IndexSchema = z.object({
  fields: z.array(z.string()).min(1),
  unique: z.boolean().optional(),
  name: z.string().optional(),
});

export const PrivilegesSchema = z.object({
  read: z.string().optional(),
  create: z.string().optional(),
  update: z.string().optional(),
  delete: z.string().optional(),
  export: z.string().optional(),
});

export const MaskingRuleSchema = z.object({
  field: z.string(),
  pattern: z.string(),
  replacement: z.string(),
  /** If user has this privilege, skip masking */
  unlessPrivilege: z.string().optional(),
  /** If user has any of these roles, skip masking */
  unlessRole: z.array(z.string()).optional(),
});
export type MaskingRule = z.infer<typeof MaskingRuleSchema>;

export const AuditSchema = z.object({
  eventPrefix: z.string().min(1),
  sensitiveFields: z.array(z.string()).optional(),
});

export const SearchSchema = z.object({
  fields: z.array(z.string()).min(1),
});

export const EntitySchemaV1 = z.object({
  $schema: z.string().optional(),
  entity: z.string().min(1),
  displayName: z.string().optional(),
  namespace: NamespaceEnum,
  hashIdPrefix: z.string().min(1),
  table: z.string().min(1),
  softDelete: z.boolean().default(true),
  timestamps: z.boolean().default(true),
  version: z.boolean().default(true),
  /** Optional — URL slug for the resource. Defaults to `${entity}s` */
  resource: z.string().optional(),

  fields: z.array(FieldSchema).min(1),
  indexes: z.array(IndexSchema).optional(),
  privileges: PrivilegesSchema.optional(),
  masking: z
    .object({ rules: z.array(MaskingRuleSchema).default([]) })
    .optional(),
  audit: AuditSchema,
  search: SearchSchema.optional(),
});

export type EntityDeclaration = z.infer<typeof EntitySchemaV1>;

/**
 * Parse a raw JSON object as an entity declaration.
 * Throws a Zod error with a human-readable message on failure.
 */
export function parseEntityDeclaration(raw: unknown): EntityDeclaration {
  return EntitySchemaV1.parse(raw);
}

/**
 * Safe variant — returns a discriminated result instead of throwing.
 */
export function safeParseEntityDeclaration(
  raw: unknown,
):
  | { ok: true; data: EntityDeclaration }
  | { ok: false; error: string } {
  const result = EntitySchemaV1.safeParse(raw);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return {
    ok: false,
    error: result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; '),
  };
}
