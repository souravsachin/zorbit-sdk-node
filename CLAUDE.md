# Zorbit Service: sdk-node

## Purpose

This repository implements the Node.js/TypeScript SDK for building applications on the Zorbit platform.

Zorbit is a MACH-compliant shared platform infrastructure used to build enterprise applications.

The package is published as `@zorbit-platform/sdk-node`.

## Responsibilities

- Identity middleware (JWT validation for Express-compatible servers)
- Authorization middleware (privilege checks against the authorization service)
- Namespace middleware (enforce namespace isolation from JWT claims)
- Kafka client wrapper (publish/subscribe with canonical event envelope)
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

Forbidden dependencies:

- direct database access to other services
- cross-service code imports
- NestJS framework dependencies (this is a plain library)

## Platform Dependencies

Upstream services:
- zorbit-identity (JWT issuer, token validation)
- zorbit-authorization (privilege checks)

Downstream consumers:
- All Zorbit platform services
- All applications built on the Zorbit platform

## Repository Structure

```
/src
  /middleware      - Express-compatible middleware (JWT, authorization, namespace)
  /kafka           - Kafka client wrapper and event envelope
  /observability   - OpenTelemetry tracing setup
  /config          - Configuration loader
  /errors          - Standard error classes
  /utils           - Hash ID generator, namespace utilities
  index.ts         - Re-exports all submodules
/tests             - Jest unit tests
package.json
tsconfig.json
```

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

## API Endpoints

This is a library. It does not expose API endpoints.

It provides middleware for services that expose API endpoints.

## Development Guidelines

Follow Zorbit architecture rules.

- All exports must go through src/index.ts
- Middleware must be Express-compatible (req, res, next signature)
- Error classes must include HTTP status codes and error codes
- Hash IDs must use crypto.randomBytes for randomness
- Event envelope must follow the canonical format from zorbit-core
- Configuration loader must support environment variables and .env files
