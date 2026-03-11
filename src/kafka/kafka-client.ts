import { Kafka, Producer, Consumer, EachMessagePayload, logLevel } from 'kafkajs';
import { ZorbitEvent, createEvent } from './event-envelope';

export interface ZorbitKafkaConfig {
  /** Kafka broker addresses */
  brokers: string[];
  /** Client ID for this service */
  clientId: string;
  /** Consumer group ID */
  groupId?: string;
  /** Dead letter queue topic (default: 'zorbit.dlq') */
  dlqTopic?: string;
  /** Connection timeout in ms (default: 10000) */
  connectionTimeout?: number;
  /** Kafka log level (default: WARN) */
  logLevel?: logLevel;
}

export type EventHandler<T = Record<string, unknown>> = (event: ZorbitEvent<T>) => Promise<void>;

/**
 * Zorbit Kafka client wrapper.
 *
 * Provides a simplified interface for publishing and subscribing
 * to events using the canonical Zorbit event envelope.
 */
export class ZorbitKafkaClient {
  private kafka: Kafka;
  private producer: Producer | null = null;
  private consumer: Consumer | null = null;
  private config: Required<Pick<ZorbitKafkaConfig, 'dlqTopic'>> & ZorbitKafkaConfig;

  constructor(config: ZorbitKafkaConfig) {
    this.config = {
      ...config,
      dlqTopic: config.dlqTopic || 'zorbit.dlq',
    };

    this.kafka = new Kafka({
      clientId: config.clientId,
      brokers: config.brokers,
      connectionTimeout: config.connectionTimeout || 10000,
      logLevel: config.logLevel ?? logLevel.WARN,
    });
  }

  /**
   * Connect the producer. Must be called before publishing events.
   */
  async connectProducer(): Promise<void> {
    this.producer = this.kafka.producer();
    await this.producer.connect();
  }

  /**
   * Connect the consumer. Must be called before subscribing to events.
   */
  async connectConsumer(): Promise<void> {
    if (!this.config.groupId) {
      throw new Error('groupId is required to create a consumer');
    }
    this.consumer = this.kafka.consumer({ groupId: this.config.groupId });
    await this.consumer.connect();
  }

  /**
   * Publish an event to a Kafka topic using the canonical event envelope.
   *
   * @param topic - Kafka topic name
   * @param eventType - Event type (e.g. 'identity.user.created')
   * @param namespace - Namespace context
   * @param actor - Actor who triggered the event
   * @param data - Event payload
   * @param metadata - Optional metadata
   */
  async publish<T = Record<string, unknown>>(
    topic: string,
    eventType: string,
    namespace: { type: string; id: string },
    actor: { type: 'user' | 'system' | 'service'; id: string },
    data: T,
    metadata?: Record<string, string>,
  ): Promise<ZorbitEvent<T>> {
    if (!this.producer) {
      throw new Error('Producer not connected. Call connectProducer() first.');
    }

    const event = createEvent(eventType, this.config.clientId, namespace, actor, data, metadata);

    await this.producer.send({
      topic,
      messages: [
        {
          key: event.eventId,
          value: JSON.stringify(event),
          headers: {
            eventType: event.eventType,
            source: event.source,
            eventId: event.eventId,
          },
        },
      ],
    });

    return event;
  }

  /**
   * Subscribe to a Kafka topic and process events with the provided handler.
   *
   * Failed messages are forwarded to the dead letter queue.
   *
   * @param topic - Kafka topic name
   * @param handler - Async function to process each event
   */
  async subscribe<T = Record<string, unknown>>(
    topic: string,
    handler: EventHandler<T>,
  ): Promise<void> {
    if (!this.consumer) {
      throw new Error('Consumer not connected. Call connectConsumer() first.');
    }

    await this.consumer.subscribe({ topic, fromBeginning: false });

    await this.consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        const { message } = payload;

        try {
          const value = message.value?.toString();
          if (!value) return;

          const event: ZorbitEvent<T> = JSON.parse(value);
          await handler(event);
        } catch (err) {
          await this.forwardToDlq(topic, message.value?.toString() || '', err);
        }
      },
    });
  }

  /**
   * Forward a failed message to the dead letter queue.
   */
  private async forwardToDlq(
    originalTopic: string,
    originalMessage: string,
    error: unknown,
  ): Promise<void> {
    if (!this.producer) return;

    try {
      await this.producer.send({
        topic: this.config.dlqTopic,
        messages: [
          {
            value: JSON.stringify({
              originalTopic,
              originalMessage,
              error: error instanceof Error ? error.message : String(error),
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      });
    } catch (_dlqError) {
      // If DLQ forwarding fails, log but don't throw
      console.error('Failed to forward message to DLQ:', _dlqError);
    }
  }

  /**
   * Disconnect producer and consumer.
   */
  async disconnect(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
      this.producer = null;
    }
    if (this.consumer) {
      await this.consumer.disconnect();
      this.consumer = null;
    }
  }
}
