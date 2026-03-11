// Middleware
export { jwtAuthMiddleware, JwtAuthOptions } from './middleware/jwt-auth.middleware';
export { authorizationMiddleware, AuthorizationOptions } from './middleware/authorization.middleware';
export { namespaceMiddleware, NamespaceMiddlewareOptions } from './middleware/namespace.middleware';

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
