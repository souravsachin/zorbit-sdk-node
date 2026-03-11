# @zorbit-platform/sdk-node

Node.js/TypeScript SDK for building applications on the Zorbit platform.

## Installation

```bash
npm install @zorbit-platform/sdk-node
```

## Usage

### JWT Authentication Middleware

```typescript
import { jwtAuthMiddleware } from '@zorbit-platform/sdk-node';

app.use(jwtAuthMiddleware({
  secret: process.env.JWT_SECRET,
  issuer: 'accounts.platform.com',
}));
```

### Authorization Middleware

```typescript
import { authorizationMiddleware } from '@zorbit-platform/sdk-node';

app.get('/api/v1/O/:orgId/reports',
  authorizationMiddleware(['REPORT_VIEW'], {
    authorizationServiceUrl: 'http://zorbit-authorization:3000',
  }),
  handler,
);
```

### Namespace Middleware

```typescript
import { namespaceMiddleware } from '@zorbit-platform/sdk-node';

app.use('/api/v1/O/:orgId', namespaceMiddleware());
```

### Kafka Events

```typescript
import { ZorbitKafkaClient } from '@zorbit-platform/sdk-node';

const kafka = new ZorbitKafkaClient({
  brokers: ['localhost:9092'],
  clientId: 'my-service',
  groupId: 'my-service-group',
});

await kafka.connectProducer();

// Publish an event
await kafka.publish(
  'identity.events',
  'identity.user.created',
  { type: 'O', id: 'O-92AF' },
  { type: 'user', id: 'U-81F3' },
  { name: 'Jane Doe', email_token: 'PII-4F2A' },
);

// Subscribe to events
await kafka.connectConsumer();
await kafka.subscribe('identity.events', async (event) => {
  console.log('Received:', event.eventType, event.data);
});
```

### Hash ID Generation

```typescript
import { generateHashId, validateHashId } from '@zorbit-platform/sdk-node';

const userId = generateHashId('U');    // 'U-81F3'
const eventId = generateHashId('EV');  // 'EV-883A'

validateHashId('U-81F3');       // true
validateHashId('U-81F3', 'U');  // true
validateHashId('invalid');      // false
```

### Error Handling

```typescript
import {
  NotFoundError,
  ValidationError,
  ZorbitError,
} from '@zorbit-platform/sdk-node';

throw new NotFoundError('Customer not found');
throw new ValidationError('Invalid input', { fields: { email: 'Required' } });

// Errors serialize to standard API format:
// { error: { code: 'NOT_FOUND', message: '...', statusCode: 404 } }
```

### Configuration

```typescript
import { loadConfig } from '@zorbit-platform/sdk-node';

const config = loadConfig();
// Loads from environment variables and .env file
// config.serviceName, config.jwtSecret, config.kafkaBrokers, etc.
```

### OpenTelemetry Tracing

```typescript
import { initTracing } from '@zorbit-platform/sdk-node';

initTracing({
  serviceName: 'my-service',
  otlpEndpoint: 'http://otel-collector:4318',
});
```

### Namespace Utilities

```typescript
import { NamespaceType, parseNamespace, validateNamespaceAccess } from '@zorbit-platform/sdk-node';

const ns = parseNamespace('O', 'O-92AF');
// { type: NamespaceType.Organization, id: 'O-92AF' }

const hasAccess = validateNamespaceAccess(
  { sub: 'U-81F3', org: 'O-92AF' },
  { type: NamespaceType.Organization, id: 'O-92AF' },
);
// true
```

## Development

```bash
npm install
npm run build
npm test
```

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
