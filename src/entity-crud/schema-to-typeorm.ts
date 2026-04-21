/**
 * Map an entity declaration's field types to TypeORM column metadata.
 *
 * We deliberately avoid building a dynamic `EntitySchema` at runtime
 * (that requires a per-module DataSource config). Instead each consumer
 * keeps its existing TypeORM entity classes and the factory becomes a
 * generic CRUD engine that operates on `Repository<T>`. This helper is
 * used for:
 *   1. Metadata introspection (`GET /api/.../G/entities/<entity>`)
 *   2. Seeding / migration — future `zorbit cli` to scaffold a
 *      TypeORM entity from a declaration.
 */
import type { EntityField } from './entity-schema';

export interface ColumnDescriptor {
  name: string;
  type: string;
  length?: number;
  nullable: boolean;
  unique: boolean;
  default?: unknown;
  enumValues?: string[];
  /** Snake-cased column name */
  columnName: string;
}

/**
 * Map a declaration field to a descriptor that hints at the column
 * structure. Used by `ZorbitEntityMetadataController` and by the
 * forthcoming `zorbit scaffold entity` CLI command.
 */
export function fieldToColumnDescriptor(field: EntityField): ColumnDescriptor {
  const columnName = toSnake(field.key);
  const base: ColumnDescriptor = {
    name: field.key,
    columnName,
    type: 'varchar',
    nullable: !field.required && !field.readonly,
    unique: !!field.unique,
    default: field.default,
  };

  switch (field.type) {
    case 'id':
      base.type = 'varchar';
      base.length = 20;
      base.unique = true;
      base.nullable = false;
      break;
    case 'text':
    case 'email':
    case 'url':
      base.type = 'varchar';
      base.length = field.maxLength || 255;
      break;
    case 'longtext':
      base.type = 'text';
      break;
    case 'number':
      base.type = 'numeric';
      break;
    case 'integer':
      base.type = 'integer';
      break;
    case 'boolean':
      base.type = 'boolean';
      break;
    case 'date':
      base.type = 'date';
      break;
    case 'datetime':
    case 'timestamp':
      base.type = 'timestamp';
      break;
    case 'enum':
      base.type = 'enum';
      base.enumValues = field.values || [];
      break;
    case 'ref':
      base.type = 'varchar';
      base.length = 20;
      break;
    case 'json':
    case 'jsonb':
      base.type = 'jsonb';
      break;
    case 'secret':
    case 'pii':
      // Stored as a token reference — short string
      base.type = 'varchar';
      base.length = 64;
      break;
  }

  return base;
}

function toSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()).replace(/^_/, '');
}
