import { Kafka, Producer, logLevel } from 'kafkajs';
import { generateHashId } from '../utils/hash-id';

/**
 * Configuration for the audit trail interceptor.
 */
export interface AuditLoggerConfig {
  /** Kafka broker addresses */
  kafkaBrokers: string[];
  /** Name of the service emitting audit events */
  serviceName: string;
  /** Kafka topic for audit events (default: 'zorbit-audit-trail') */
  topic?: string;
  /** Kafka client ID (default: serviceName + '-audit') */
  clientId?: string;
}

/**
 * A single field-level change within an audit event.
 */
export interface AuditChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

/**
 * Canonical audit event published to Kafka.
 */
export interface AuditEvent {
  /** Unique event identifier (e.g. AUD-A1B2) */
  eventId: string;
  /** Type of mutation */
  eventType: 'create' | 'update' | 'delete';
  /** Service that performed the operation */
  serviceName: string;
  /** Entity type (e.g. 'quotation', 'rule', 'user') */
  entityType: string;
  /** Entity identifier */
  entityId: string;
  /** Organization namespace */
  organizationHashId: string;
  /** User who performed the action */
  userHashId: string;
  /** Field-level changes */
  changes: AuditChange[];
  /** Client IP address */
  ipAddress?: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Compute field-level changes between two objects.
 *
 * Only top-level fields are compared. Nested objects are compared
 * by JSON serialization for simplicity.
 */
export function computeChanges(
  oldObj: Record<string, unknown> | null,
  newObj: Record<string, unknown>,
): AuditChange[] {
  const changes: AuditChange[] = [];

  if (!oldObj) {
    // Create operation: all fields in newObj are changes
    for (const [key, value] of Object.entries(newObj)) {
      changes.push({ field: key, oldValue: null, newValue: value });
    }
    return changes;
  }

  // Check for modified and new fields
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  for (const key of allKeys) {
    const oldVal = oldObj[key];
    const newVal = newObj[key];

    const oldSerialized = JSON.stringify(oldVal);
    const newSerialized = JSON.stringify(newVal);

    if (oldSerialized !== newSerialized) {
      changes.push({ field: key, oldValue: oldVal ?? null, newValue: newVal ?? null });
    }
  }

  return changes;
}

/**
 * Build an AuditEvent object (without publishing it).
 * Useful for testing or custom publishing logic.
 */
export function buildAuditEvent(
  eventType: 'create' | 'update' | 'delete',
  serviceName: string,
  entityType: string,
  entityId: string,
  organizationHashId: string,
  userHashId: string,
  changes: AuditChange[],
  ipAddress?: string,
): AuditEvent {
  return {
    eventId: generateHashId('AUD'),
    eventType,
    serviceName,
    entityType,
    entityId,
    organizationHashId,
    userHashId,
    changes,
    ipAddress,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create an audit logger that publishes audit events to Kafka.
 *
 * Returns an object with methods to log create, update, and delete operations.
 * The logger manages its own Kafka producer connection.
 *
 * @example
 * ```typescript
 * const auditLogger = createAuditLogger({
 *   kafkaBrokers: ['localhost:9092'],
 *   serviceName: 'sample-customer-service',
 * });
 *
 * await auditLogger.connect();
 *
 * await auditLogger.logCreate({
 *   entityType: 'customer',
 *   entityId: 'CUST-A1B2',
 *   organizationHashId: 'O-92AF',
 *   userHashId: 'U-81F3',
 *   newData: { name_token: 'PII-1234', status: 'active' },
 *   ipAddress: '10.0.0.1',
 * });
 *
 * await auditLogger.logUpdate({
 *   entityType: 'customer',
 *   entityId: 'CUST-A1B2',
 *   organizationHashId: 'O-92AF',
 *   userHashId: 'U-81F3',
 *   oldData: { status: 'active' },
 *   newData: { status: 'inactive' },
 * });
 *
 * await auditLogger.logDelete({
 *   entityType: 'customer',
 *   entityId: 'CUST-A1B2',
 *   organizationHashId: 'O-92AF',
 *   userHashId: 'U-81F3',
 *   oldData: { status: 'inactive' },
 * });
 *
 * await auditLogger.disconnect();
 * ```
 */
export function createAuditLogger(config: AuditLoggerConfig) {
  const topic = config.topic || 'zorbit-audit-trail';
  const clientId = config.clientId || `${config.serviceName}-audit`;

  const kafka = new Kafka({
    clientId,
    brokers: config.kafkaBrokers,
    logLevel: logLevel.WARN,
  });

  let producer: Producer | null = null;

  async function publishEvent(event: AuditEvent): Promise<AuditEvent> {
    if (!producer) {
      throw new Error('Audit logger not connected. Call connect() first.');
    }

    await producer.send({
      topic,
      messages: [
        {
          key: event.eventId,
          value: JSON.stringify(event),
          headers: {
            eventType: `audit.${event.entityType}.${event.eventType}`,
            source: config.serviceName,
            eventId: event.eventId,
          },
        },
      ],
    });

    return event;
  }

  return {
    /** Connect the Kafka producer. Must be called before logging. */
    async connect(): Promise<void> {
      producer = kafka.producer();
      await producer.connect();
    },

    /** Disconnect the Kafka producer. */
    async disconnect(): Promise<void> {
      if (producer) {
        await producer.disconnect();
        producer = null;
      }
    },

    /** Log a create operation. */
    async logCreate(params: {
      entityType: string;
      entityId: string;
      organizationHashId: string;
      userHashId: string;
      newData: Record<string, unknown>;
      ipAddress?: string;
    }): Promise<AuditEvent> {
      const changes = computeChanges(null, params.newData);
      const event = buildAuditEvent(
        'create',
        config.serviceName,
        params.entityType,
        params.entityId,
        params.organizationHashId,
        params.userHashId,
        changes,
        params.ipAddress,
      );
      return publishEvent(event);
    },

    /** Log an update operation. */
    async logUpdate(params: {
      entityType: string;
      entityId: string;
      organizationHashId: string;
      userHashId: string;
      oldData: Record<string, unknown>;
      newData: Record<string, unknown>;
      ipAddress?: string;
    }): Promise<AuditEvent> {
      const changes = computeChanges(params.oldData, params.newData);
      if (changes.length === 0) {
        // No actual changes, skip audit
        return buildAuditEvent(
          'update',
          config.serviceName,
          params.entityType,
          params.entityId,
          params.organizationHashId,
          params.userHashId,
          [],
          params.ipAddress,
        );
      }
      const event = buildAuditEvent(
        'update',
        config.serviceName,
        params.entityType,
        params.entityId,
        params.organizationHashId,
        params.userHashId,
        changes,
        params.ipAddress,
      );
      return publishEvent(event);
    },

    /** Log a delete operation. */
    async logDelete(params: {
      entityType: string;
      entityId: string;
      organizationHashId: string;
      userHashId: string;
      oldData: Record<string, unknown>;
      ipAddress?: string;
    }): Promise<AuditEvent> {
      const changes = computeChanges(params.oldData, {});
      const event = buildAuditEvent(
        'delete',
        config.serviceName,
        params.entityType,
        params.entityId,
        params.organizationHashId,
        params.userHashId,
        changes,
        params.ipAddress,
      );
      return publishEvent(event);
    },
  };
}
