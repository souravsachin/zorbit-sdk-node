# @zorbit-platform/sdk-node

Node.js/TypeScript SDK for building applications on the Zorbit platform.

## Installation

```bash
npm install @zorbit-platform/sdk-node
```

Or as a file dependency in a monorepo:

```json
"@zorbit-platform/sdk-node": "file:../zorbit-sdk-node"
```

## Quick Start

```typescript
import {
  JwtAuthGuard,
  PiiVaultClient,
  ZorbitKafkaClient,
  loadConfig,
  generateHashId,
} from '@zorbit-platform/sdk-node';
```

---

## Capabilities

### 1. JWT Authentication Middleware

Express-compatible middleware that validates JWT Bearer tokens.

```typescript
import { jwtAuthMiddleware } from '@zorbit-platform/sdk-node';

app.use(jwtAuthMiddleware({
  secret: process.env.JWT_SECRET,
  issuer: 'accounts.platform.com',
}));
// Decoded JWT is available as req.user
```

### 2. JWT Auth Guard (NestJS-compatible)

A guard class with role/privilege checking, usable as NestJS guard or Express middleware.

```typescript
import { JwtAuthGuard } from '@zorbit-platform/sdk-node';

// As Express middleware
app.use(JwtAuthGuard.asMiddleware({
  secret: process.env.JWT_SECRET!,
  roles: ['admin', 'superadmin'],
  privileges: ['CUSTOMER_VIEW'],
}));

// In a NestJS CanActivate implementation
const guard = new JwtAuthGuard({ secret: process.env.JWT_SECRET! });
canActivate(context) {
  return guard.validateRequest(context.switchToHttp().getRequest());
}
```

### 3. Authorization Middleware

Checks required privileges against the Zorbit authorization service.

```typescript
import { authorizationMiddleware } from '@zorbit-platform/sdk-node';

app.get('/api/v1/O/:orgId/reports',
  authorizationMiddleware(['REPORT_VIEW'], {
    authorizationServiceUrl: 'http://zorbit-authorization:3102',
  }),
  handler,
);
```

### 4. Namespace Middleware

Enforces namespace isolation from JWT claims.

```typescript
import { namespaceMiddleware } from '@zorbit-platform/sdk-node';

app.use('/api/v1/O/:orgId', namespaceMiddleware());
```

### 5. Kafka Events

Publish and subscribe to events with the canonical Zorbit event envelope.

```typescript
import { ZorbitKafkaClient } from '@zorbit-platform/sdk-node';

const kafka = new ZorbitKafkaClient({
  brokers: ['localhost:9092'],
  clientId: 'my-service',
  groupId: 'my-service-group',
});

await kafka.connectProducer();

await kafka.publish(
  'identity.events',
  'identity.user.created',
  { type: 'O', id: 'O-92AF' },
  { type: 'user', id: 'U-81F3' },
  { name: 'Jane Doe', email_token: 'PII-4F2A' },
);

await kafka.connectConsumer();
await kafka.subscribe('identity.events', async (event) => {
  console.log('Received:', event.eventType, event.data);
});
```

### 6. PII Vault Client

High-level client for tokenizing and revealing PII data.

```typescript
import { PiiVaultClient } from '@zorbit-platform/sdk-node';

const pii = new PiiVaultClient({
  piiVaultUrl: 'http://localhost:3105',
  defaultOrgHashId: 'O-92AF',
});

// Tokenize
const token = await pii.tokenize('john@example.com', 'email', 'email', jwtToken);

// Reveal
const value = await pii.reveal(token, 'O-92AF', jwtToken);

// Bulk tokenize
const tokens = await pii.tokenizeBulk([
  { value: 'John', fieldName: 'firstName', piiType: 'name' },
  { value: 'john@example.com', fieldName: 'email', piiType: 'email' },
], jwtToken);

// Bulk reveal
const revealed = await pii.revealBulk(['PII-A1B2', 'PII-C3D4'], jwtToken);
```

### 7. PII Auto-Detection Interceptor

Scans objects for PII patterns and auto-tokenizes via the vault.

```typescript
import { createPIIDetector, detectPII, BUILTIN_PATTERNS } from '@zorbit-platform/sdk-node';

const piiDetector = createPIIDetector({
  piiVaultUrl: 'http://localhost:3105',
  orgHashId: 'O-92AF',
  enabled: true,
  authToken: jwtToken,
  skipFields: ['hashId', 'organizationHashId'],
});

const result = await piiDetector({
  firstName: 'John',
  email: 'john@example.com',
  status: 'active',
});
// result.data = { firstName: 'PII-A1B2', email: 'PII-C3D4', status: 'active' }

// Detection-only (no vault calls)
const detections = detectPII(
  { email: 'test@example.com', ssn: '123-45-6789' },
  BUILTIN_PATTERNS,
);
```

### 8. Form Builder Client

Interact with the Zorbit Form Builder service.

```typescript
import { FormBuilderClient } from '@zorbit-platform/sdk-node';

const forms = new FormBuilderClient({
  formBuilderUrl: 'http://localhost:3114',
});

const templates = await forms.listForms('O-92AF', jwtToken);
const schema = await forms.getForm('FRM-A1B2', 'O-92AF', jwtToken);
await forms.submitForm('FRM-A1B2', formData, 'O-92AF', jwtToken);
const subs = await forms.getSubmissions('FRM-A1B2', 'O-92AF', jwtToken);
```

### 9. DataTable Client

Register page configurations and query data from the DataTable service.

```typescript
import { DataTableClient } from '@zorbit-platform/sdk-node';

const dt = new DataTableClient({
  dataTableUrl: 'http://localhost:3113',
});

// Register a page config
await dt.registerPage({
  shortname: 'customers',
  title: 'Customers',
  columns: [
    { field: 'name', header: 'Name', type: 'pii', piiType: 'name' },
    { field: 'status', header: 'Status', type: 'status' },
  ],
  dataSource: { type: 'api', endpoint: '/api/v1/O/{orgId}/customers' },
  organizationHashId: 'O-92AF',
}, 'O-92AF', jwtToken);

// Fetch paginated data
const page = await dt.getData('customers', 'O-92AF', jwtToken, {
  page: 1, pageSize: 25, search: 'john',
});
```

### 10. Audit Trail Logger

Publishes field-level audit events to Kafka.

```typescript
import { createAuditLogger } from '@zorbit-platform/sdk-node';

const auditLogger = createAuditLogger({
  kafkaBrokers: ['localhost:9092'],
  serviceName: 'sample-customer-service',
});

await auditLogger.connect();

await auditLogger.logCreate({
  entityType: 'customer',
  entityId: 'CUST-A1B2',
  organizationHashId: 'O-92AF',
  userHashId: 'U-81F3',
  newData: { name_token: 'PII-1234', status: 'active' },
  ipAddress: '10.0.0.1',
});

await auditLogger.logUpdate({
  entityType: 'customer',
  entityId: 'CUST-A1B2',
  organizationHashId: 'O-92AF',
  userHashId: 'U-81F3',
  oldData: { status: 'active' },
  newData: { status: 'inactive' },
});

await auditLogger.disconnect();
```

### 11. Hash ID Generation

Generate short hash identifiers (PREFIX-XXXX).

```typescript
import { generateHashId, validateHashId } from '@zorbit-platform/sdk-node';

const userId = generateHashId('U');    // 'U-81F3'
const eventId = generateHashId('EV');  // 'EV-883A'

validateHashId('U-81F3');       // true
validateHashId('U-81F3', 'U');  // true
validateHashId('invalid');      // false
```

### 12. Configuration Loader

Loads environment variables and .env files with type-safe defaults.

```typescript
import { loadConfig } from '@zorbit-platform/sdk-node';

const config = loadConfig();
// config.serviceName, config.jwtSecret, config.kafkaBrokers, etc.
```

### 13. Error Utilities

Standard error classes with HTTP status codes and API error response format.

```typescript
import {
  NotFoundError,
  ValidationError,
  ForbiddenError,
  ConflictError,
} from '@zorbit-platform/sdk-node';

throw new NotFoundError('Customer not found');
throw new ValidationError('Invalid input', { fields: { email: 'Required' } });
// Serializes to: { error: { code: 'NOT_FOUND', message: '...', statusCode: 404 } }
```

### 14. API Quota Management

Rate limiting with multiple sliding time windows.

```typescript
import { createQuotaManager } from '@zorbit-platform/sdk-node';

app.use(createQuotaManager({
  windows: {
    perSecond: 10,
    perMinute: 60,
    perHour: 1000,
  },
}));
```

### 15. MongoDB Adapter

Mongoose connection with directConnection=true and optional PII/audit hooks.

```typescript
import { createMongoConnection, createMongooseModuleConfig } from '@zorbit-platform/sdk-node';

const connection = await createMongoConnection({
  uri: 'mongodb://localhost:27017',
  dbName: 'zorbit-datatable',
  piiDetector: { piiVaultUrl: 'http://localhost:3105', orgHashId: 'O-92AF', enabled: true },
  auditLogger: { kafkaBrokers: ['localhost:9092'], serviceName: 'my-service' },
});
```

### 16. OpenTelemetry Tracing

```typescript
import { initTracing } from '@zorbit-platform/sdk-node';

initTracing({
  serviceName: 'my-service',
  otlpEndpoint: 'http://otel-collector:4318',
});
```

### 17. Namespace Utilities

```typescript
import { NamespaceType, parseNamespace, validateNamespaceAccess } from '@zorbit-platform/sdk-node';

const ns = parseNamespace('O', 'O-92AF');
const hasAccess = validateNamespaceAccess(
  { sub: 'U-81F3', org: 'O-92AF' },
  { type: NamespaceType.Organization, id: 'O-92AF' },
);
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| SERVICE_NAME | Yes | - | Service name |
| JWT_SECRET | Yes | - | JWT signing secret |
| PORT | No | 3000 | Server port |
| KAFKA_BROKERS | No | localhost:9092 | Comma-separated broker list |
| KAFKA_GROUP_ID | No | - | Consumer group ID |
| AUTHORIZATION_SERVICE_URL | No | http://localhost:3002 | Authorization service URL |
| OTLP_ENDPOINT | No | - | OpenTelemetry collector URL |
| DATABASE_URL | No | - | Database connection string |
| MONGODB_URI | No | - | MongoDB connection string |
| PII_VAULT_URL | No | http://localhost:3105 | PII Vault service URL |

## Development

```bash
npm install
npm run build
npm test
```
