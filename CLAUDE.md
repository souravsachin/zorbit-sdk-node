# Zorbit Service: sdk-node

## Purpose

This repository implements the Node.js/TypeScript SDK for building applications on the Zorbit platform.

Zorbit is a MACH-compliant shared platform infrastructure used to build enterprise applications.

The package is published as `@zorbit-platform/sdk-node`.

## Responsibilities

### Tier 1 primitives (EPIC 9 — extracted from 22 duplicated service copies)

- `canonicalJson()` / `signHmac()` / `verifyHmac()` — canonical-JSON +
  HMAC helpers that the module-registry's HmacValidatorService consumes
- `normaliseDependenciesV2()` — collapse v0/v1/v2 dependency declarations
  into the v2 `{ platform, business }` shape
- `ModuleAnnouncementService` — NestJS service that self-announces to
  zorbit-cor-module_registry via Kafka with HMAC signing, 5s boot delay,
  2s nav-cache notify; failures are non-fatal
- `AuditEventPublisher` — framework-agnostic Kafka event publisher with
  canonical envelope + non-fatal publish semantics
- `ZorbitHealthControllerBase` / `ZorbitManifestControllerBase` /
  `ZorbitSeedControllerBase` — base classes so every service's boilerplate
  `GET /api/v1/G/health`, `GET /api/v1/G/manifest` and `POST /api/v1/G/seed`
  endpoints share a single implementation

### Earlier Tier 0 modules (pre-EPIC 9)

- Identity middleware (JWT validation for Express-compatible servers)
- JWT Auth Guard (NestJS-compatible guard with role/privilege checking)
- `ZorbitJwtGuard` / `ZorbitNamespaceGuard` / `ZorbitPrivilegeGuard` (NestJS)
- Authorization middleware (privilege checks against the authorization service)
- Namespace middleware (enforce namespace isolation from JWT claims)
- Kafka client wrapper (publish/subscribe with canonical event envelope)
- PII Vault client (tokenize/reveal/bulk operations)
- Form Builder client (list forms, get schemas, submit data, get submissions)
- DataTable client (register page configs, query paginated data)
- PII auto-detection interceptor (scans objects for PII, tokenizes via PII Vault)
- Audit trail interceptor (publishes field-level audit events to Kafka)
- API quota management middleware (multi-window rate limiting with sliding windows)
- MongoDB adapter (Mongoose with directConnection=true, PII + audit hooks)
- OpenTelemetry instrumentation (tracing setup with OTLP exporter)
- Configuration loader (environment variables with type-safe interfaces)
- Error utilities (standard error classes with HTTP status codes)
- Short hash ID generator (e.g. U-81F3, O-92AF)
- Namespace validation utilities

## Architecture Context

This SDK follows Zorbit platform architecture.

Key rules:

- REST API grammar
- namespace-based multi-tenancy
- short hash identifiers
- event-driven integration
- service isolation

This is a **library package**, not a NestJS service. It exports middleware, utilities, and clients that platform services consume.

## Dependencies

Allowed dependencies:

- jsonwebtoken (JWT validation)
- kafkajs (Kafka client)
- @opentelemetry/api, @opentelemetry/sdk-node, @opentelemetry/exporter-trace-otlp-http (observability)
- axios (HTTP calls to platform services)
- mongoose (MongoDB connection with directConnection support)

Forbidden dependencies:

- direct database access to other services
- cross-service code imports
- NestJS framework dependencies (this is a plain library)

## Platform Dependencies

Upstream services:
- zorbit-identity (JWT issuer, token validation)
- zorbit-authorization (privilege checks)
- zorbit-pii-vault (PII tokenization via PiiVaultClient)
- zorbit-pfs-form_builder (form operations via FormBuilderClient)
- zorbit-pfs-datatable (data table operations via DataTableClient)
- zorbit-audit (audit event consumption)

Downstream consumers:
- All Zorbit platform services
- All applications built on the Zorbit platform

## Repository Structure

```
/src
  /clients         - Service clients (PII Vault, Form Builder, DataTable)
  /guards          - NestJS-compatible guards (JwtAuthGuard)
  /middleware       - Express-compatible middleware (JWT, authorization, namespace, quota)
  /interceptors    - PII auto-detection, audit trail interceptors
  /database        - MongoDB adapter with directConnection and hooks
  /kafka           - Kafka client wrapper and event envelope
  /observability   - OpenTelemetry tracing setup
  /config          - Configuration loader
  /errors          - Standard error classes
  /utils           - Hash ID generator, namespace utilities
  index.ts         - Re-exports all submodules
/tests             - Jest unit tests (71 tests)
package.json
tsconfig.json
```

## API Reference

### Middleware (Express-compatible)

| Export | Type | Description |
|--------|------|-------------|
| `jwtAuthMiddleware(opts)` | Middleware factory | JWT validation, attaches `req.user` |
| `authorizationMiddleware(codes, opts)` | Middleware factory | Privilege checking via auth service |
| `namespaceMiddleware(opts?)` | Middleware factory | Namespace isolation from JWT claims |
| `createQuotaManager(config)` | Middleware factory | Multi-window rate limiting |

### Guards

| Export | Type | Description |
|--------|------|-------------|
| `JwtAuthGuard` | Class | NestJS-compatible guard with role/privilege checks |
| `JwtAuthGuard.asMiddleware(opts)` | Static method | Creates Express middleware from guard |

### Service Clients

| Export | Type | Description |
|--------|------|-------------|
| `PiiVaultClient` | Class | Tokenize, reveal, bulk operations |
| `FormBuilderClient` | Class | List forms, get schemas, submit, get submissions |
| `DataTableClient` | Class | Register pages, query paginated data |

### Interceptors

| Export | Type | Description |
|--------|------|-------------|
| `createPIIDetector(config)` | Factory | Auto-detect + tokenize PII in objects |
| `detectPII(data, patterns)` | Function | Detection-only (no vault calls) |
| `createAuditLogger(config)` | Factory | Publish audit events to Kafka |
| `computeChanges(old, new)` | Function | Field-level diff |
| `buildAuditEvent(...)` | Function | Build audit event without publishing |

### Kafka

| Export | Type | Description |
|--------|------|-------------|
| `ZorbitKafkaClient` | Class | Publish/subscribe with event envelope |
| `createEvent(...)` | Function | Create canonical event envelope |

### Database

| Export | Type | Description |
|--------|------|-------------|
| `createMongoConnection(config)` | Async function | Mongoose with directConnection + hooks |
| `createMongooseModuleConfig(config)` | Function | NestJS MongooseModule config factory |

### Config & Utils

| Export | Type | Description |
|--------|------|-------------|
| `loadConfig(overrides?)` | Function | Load env vars + .env file |
| `generateHashId(prefix)` | Function | Generate PREFIX-XXXX identifier |
| `validateHashId(id, prefix?)` | Function | Validate hash ID format |
| `parseNamespace(type, id)` | Function | Parse namespace string |
| `validateNamespaceAccess(claims, ns)` | Function | Check JWT claims vs namespace |
| `initTracing(config)` | Function | Initialize OpenTelemetry |

### Error Classes

| Export | Status Code | Error Code |
|--------|-------------|------------|
| `ZorbitError` | any | any |
| `NotFoundError` | 404 | NOT_FOUND |
| `UnauthorizedError` | 401 | UNAUTHORIZED |
| `ForbiddenError` | 403 | FORBIDDEN |
| `ValidationError` | 400 | VALIDATION_ERROR |
| `ConflictError` | 409 | CONFLICT |

All errors serialize to: `{ error: { code, message, statusCode, details? } }`

## Running Locally

```bash
npm install
npm run build
npm test
```

## Events Published

This SDK provides the Kafka client for publishing events. It does not publish events itself.

All events use the canonical event envelope defined in `src/kafka/event-envelope.ts`.

## Events Consumed

This SDK provides the Kafka client for consuming events. It does not consume events itself.

## Development Guidelines

Follow Zorbit architecture rules.

- All exports must go through src/index.ts
- Middleware must be Express-compatible (req, res, next signature)
- Error classes must include HTTP status codes and error codes
- Hash IDs must use crypto.randomBytes for randomness
- Event envelope must follow the canonical format from zorbit-core
- Configuration loader must support environment variables and .env files
- Service clients must accept authToken per-call (not stored in constructor)
- Service clients must use orgHashId namespace in API paths
