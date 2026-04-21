import { Logger } from '@nestjs/common';
import { Kafka, Producer } from 'kafkajs';
import { v4 as uuidv4 } from 'uuid';

/**
 * Canonical Zorbit event envelope used for audit + business events.
 *
 * Note: this envelope is intentionally simpler than the `ZorbitEvent`
 * envelope in `src/kafka/event-envelope.ts` (which carries
 * `namespace.type/id` + `actor.type/id`). Audit/business events in the
 * current fleet (secrets_vault, deployment_registry, module_registry)
 * use this flatter shape. Both envelopes pass through canonical
 * consumers.
 */
export interface ZorbitAuditEventEnvelope<T = unknown> {
  eventId: string;
  eventType: string;
  timestamp: string;
  source: string;
  namespace: string;
  namespaceId: string;
  payload: T;
}

/**
 * Framework-agnostic audit event publisher.
 *
 * Connects a single KafkaJS producer on `init()`; callers invoke
 * `publish()` for every audit-able action. Failures are logged and
 * swallowed (events are dropped) to preserve the non-fatal Kafka
 * contract used across the Zorbit fleet.
 *
 * Typical usage from a NestJS module:
 *
 *   @Injectable()
 *   export class EventPublisherService implements OnModuleInit, OnModuleDestroy {
 *     private publisher: AuditEventPublisher;
 *     constructor(cfg: ConfigService) {
 *       this.publisher = new AuditEventPublisher({
 *         brokers: cfg.get('KAFKA_BROKERS', 'zs-kafka:9092').split(','),
 *         clientId: 'zorbit-cor-secrets_vault',
 *         source: 'zorbit-cor-secrets_vault',
 *       });
 *     }
 *     async onModuleInit()    { await this.publisher.init(); }
 *     async onModuleDestroy() { await this.publisher.close(); }
 *     async publish<T>(t: string, n: string, nId: string, p: T) {
 *       return this.publisher.publish(t, n, nId, p);
 *     }
 *   }
 */
export class AuditEventPublisher {
  private readonly logger = new Logger(AuditEventPublisher.name);
  private kafka: Kafka;
  private producer?: Producer;
  private connected = false;

  constructor(
    private readonly opts: {
      brokers: string[];
      clientId: string;
      /** service name stamped into the envelope's `source` field */
      source: string;
    },
  ) {
    this.kafka = new Kafka({ clientId: opts.clientId, brokers: opts.brokers });
  }

  /** Connect the Kafka producer. Call this from OnModuleInit. */
  async init(): Promise<void> {
    this.producer = this.kafka.producer();
    try {
      await this.producer.connect();
      this.connected = true;
      this.logger.log('Audit event publisher connected');
    } catch (err) {
      this.logger.warn(
        'Kafka producer connection failed — events will be dropped: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  /** Disconnect the Kafka producer. Call from OnModuleDestroy. */
  async close(): Promise<void> {
    try {
      await this.producer?.disconnect();
    } catch {
      // swallow on shutdown
    }
  }

  /**
   * Publish an event to Kafka using the canonical envelope.
   * Topic name is derived from `eventType` by replacing dots with hyphens.
   * Non-fatal on failure.
   *
   * @param eventType   e.g. 'platform.secret.created'
   * @param namespace   e.g. 'platform' or 'org'
   * @param namespaceId e.g. 'O-92AF' (or service id for platform events)
   * @param payload     Event-specific data
   */
  async publish<T>(
    eventType: string,
    namespace: string,
    namespaceId: string,
    payload: T,
  ): Promise<void> {
    if (!this.connected || !this.producer) {
      this.logger.warn(`Kafka not connected — dropping event ${eventType}`);
      return;
    }

    const envelope: ZorbitAuditEventEnvelope<T> = {
      eventId: uuidv4(),
      eventType,
      timestamp: new Date().toISOString(),
      source: this.opts.source,
      namespace,
      namespaceId,
      payload,
    };

    const topic = eventType.replace(/\./g, '-');
    try {
      await this.producer.send({
        topic,
        messages: [{ key: namespaceId, value: JSON.stringify(envelope) }],
      });
      this.logger.debug(`Published ${eventType} → topic ${topic}`);
    } catch (err) {
      this.logger.error(
        `Failed to publish event ${eventType}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
