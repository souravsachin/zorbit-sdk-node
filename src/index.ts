// Middleware
export { jwtAuthMiddleware, JwtAuthOptions } from './middleware/jwt-auth.middleware';
export { authorizationMiddleware, AuthorizationOptions } from './middleware/authorization.middleware';
export { namespaceMiddleware, NamespaceMiddlewareOptions } from './middleware/namespace.middleware';
export { createQuotaManager, clearQuotaStore, QuotaConfig } from './middleware/quota-manager';

// Guards
export { JwtAuthGuard, JwtGuardOptions } from './guards/jwt-auth.guard';

// Interceptors
export {
  createPIIDetector,
  detectPII,
  BUILTIN_PATTERNS,
  PIIDetectorConfig,
  PIIPattern,
  PIIDetection,
} from './interceptors/pii-detector';
export {
  createAuditLogger,
  computeChanges,
  buildAuditEvent,
  AuditLoggerConfig,
  AuditEvent,
  AuditChange,
} from './interceptors/audit-logger';

// Clients
export {
  PiiVaultClient,
  PiiVaultClientConfig,
  TokenizeResult,
  RevealResult,
} from './clients/pii-vault.client';
export {
  FormBuilderClient,
  FormBuilderClientConfig,
  FormTemplate,
  FormSubmission,
} from './clients/form-builder.client';
export {
  DataTableClient,
  DataTableClientConfig,
  DataTablePageConfig,
  DataTableColumn,
  DataTableDataSource,
  DataTableFilterDef,
  DataTablePage,
  DataTableQuery,
} from './clients/datatable.client';

// Database
export {
  createMongoConnection,
  createMongooseModuleConfig,
  ensureDirectConnection,
  MongoAdapterConfig,
} from './database/mongo-adapter';

// Kafka
export { ZorbitKafkaClient, ZorbitKafkaConfig } from './kafka/kafka-client';
export { ZorbitEvent, createEvent } from './kafka/event-envelope';

// Observability
export { initTracing, TracingConfig } from './observability/tracing';

// Config
export { loadConfig, ZorbitConfig } from './config/config-loader';

// Errors
export {
  ZorbitError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  ConflictError,
} from './errors/zorbit-error';

// Utils
export { generateHashId, validateHashId } from './utils/hash-id';
export { NamespaceType, parseNamespace, validateNamespaceAccess, Namespace } from './utils/namespace';

// NestJS Guards, Decorators, Strategy, Base Controllers
// (requires @nestjs/* peer dependencies)
export {
  ZorbitJwtGuard,
  ZorbitNamespaceGuard,
  ZorbitPrivilegeGuard,
  Public,
  RequirePrivileges,
  ZorbitJwtStrategy,
  ZorbitHealthControllerBase,
  ZorbitManifestControllerBase,
  ZorbitSeedControllerBase,
  IS_PUBLIC_KEY,
  REQUIRED_PRIVILEGES_KEY,
} from './nestjs';
export type { ZorbitJwtPayload, ZorbitSeedResult } from './nestjs';

// Canonical JSON + HMAC primitives (Tier 1 SDK extraction)
export { canonicalJson, canonicalize, signHmac, verifyHmac } from './canonical-json';
export { normaliseDependenciesV2, DependenciesV2 } from './dependencies';

// Module self-announcement service (Kafka + HMAC + retry + nav-cache-notify)
export {
  ModuleAnnouncementService,
  ModuleManifestAnnouncementFields,
  ModuleAnnouncementMessage,
  ModuleAnnouncementOptions,
} from './module-announcement';

// Audit / generic Kafka event publisher
export { AuditEventPublisher, ZorbitAuditEventEnvelope } from './audit';

// Shared JWT payload type (SDK-level canonical form)
export type { ZorbitJwtPayload as ZorbitJwtPayloadShared } from './types/jwt-payload';

// Entity CRUD — config-driven REST CRUD factory (EPIC 10)
export {
  ZorbitEntityCrudModule,
  createEntityService,
  buildEntityController,
  parseEntityDeclaration,
  safeParseEntityDeclaration,
  loadEntitiesFromDir,
  parseQuery as parseEntityCrudQuery,
  rowsToCsv,
  maskRows,
  maskRow,
  shouldMask,
  applyPattern,
  emitAudit,
  diffFields,
  redactSensitive,
  fieldToColumnDescriptor,
  EntitySchemaV1,
  ConcurrencyConflictError,
  EntityNotFoundError,
  ValidationFailedError,
} from './entity-crud';
export type {
  EntityDeclaration,
  EntityField,
  EntityFieldType,
  EntityNamespace,
  MaskingRule,
  MaskingContext,
  CrudActor,
  ListResult,
  ConcurrencyCheck,
  EntityServiceConfig,
  CustomHandlers,
  ControllerFactoryInput,
  ZorbitEntityCrudRegisterOptions,
  ParsedQuery,
  RawQuery,
  FilterShape,
  EntityLoadResult,
  ColumnDescriptor,
  CrudOp,
  EmitAuditOptions,
  CsvExportOptions,
} from './entity-crud';
