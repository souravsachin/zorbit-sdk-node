/**
 * Entity CRUD — config-driven REST CRUD factory.
 *
 * See docs: /Users/s/workspace/zorbit/00_docs/platform/SPEC-entity-crud.md
 */
export {
  EntitySchemaV1,
  FieldSchema,
  IndexSchema,
  PrivilegesSchema,
  MaskingRuleSchema,
  AuditSchema,
  SearchSchema,
  NamespaceEnum,
  FieldTypeEnum,
  parseEntityDeclaration,
  safeParseEntityDeclaration,
} from './entity-schema';
export type {
  EntityDeclaration,
  EntityField,
  EntityFieldType,
  EntityNamespace,
  MaskingRule,
} from './entity-schema';

export { loadEntitiesFromDir } from './entity-loader';
export type { EntityLoadResult } from './entity-loader';

export {
  fieldToColumnDescriptor,
} from './schema-to-typeorm';
export type { ColumnDescriptor } from './schema-to-typeorm';

export {
  shouldMask,
  applyPattern,
  maskRow,
  maskRows,
} from './masking';
export type { MaskingContext } from './masking';

export { parseQuery } from './filter-parser';
export type { ParsedQuery, RawQuery, FilterShape } from './filter-parser';

export {
  rowsToCsv,
} from './export';
export type { CsvExportOptions } from './export';

export {
  emitAudit,
  diffFields,
  redactSensitive,
} from './audit';
export type { CrudOp, EmitAuditOptions } from './audit';

export {
  createEntityService,
  ConcurrencyConflictError,
  EntityNotFoundError,
  ValidationFailedError,
} from './service-factory';
export type {
  CrudActor,
  ListResult,
  ConcurrencyCheck,
  EntityServiceConfig,
} from './service-factory';

export {
  buildEntityController,
} from './controller-factory';
export type {
  CustomHandlers,
  ControllerFactoryInput,
} from './controller-factory';

export {
  ZorbitEntityCrudModule,
} from './entity-crud.module';
export type {
  ZorbitEntityCrudRegisterOptions,
} from './entity-crud.module';
