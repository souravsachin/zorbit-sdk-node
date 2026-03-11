import { generateHashId } from '../utils/hash-id';

/**
 * Canonical Zorbit event envelope.
 *
 * All events published through the platform must conform to this structure.
 */
export interface ZorbitEvent<T = Record<string, unknown>> {
  /** Unique event identifier (e.g. EV-883A) */
  eventId: string;
  /** Event type following domain.entity.action pattern (e.g. identity.user.created) */
  eventType: string;
  /** Source service that produced the event */
  source: string;
  /** ISO 8601 timestamp of when the event was created */
  timestamp: string;
  /** Namespace context for the event */
  namespace: {
    type: string;
    id: string;
  };
  /** Actor who triggered the event */
  actor: {
    type: 'user' | 'system' | 'service';
    id: string;
  };
  /** Event payload data */
  data: T;
  /** Optional metadata */
  metadata?: Record<string, string>;
}

/**
 * Creates a new Zorbit event with the canonical envelope structure.
 *
 * @param eventType - Event type (e.g. 'identity.user.created')
 * @param source - Source service name
 * @param namespace - Namespace context { type, id }
 * @param actor - Actor who triggered the event { type, id }
 * @param data - Event payload
 * @param metadata - Optional metadata key-value pairs
 */
export function createEvent<T = Record<string, unknown>>(
  eventType: string,
  source: string,
  namespace: { type: string; id: string },
  actor: { type: 'user' | 'system' | 'service'; id: string },
  data: T,
  metadata?: Record<string, string>,
): ZorbitEvent<T> {
  return {
    eventId: generateHashId('EV'),
    eventType,
    source,
    timestamp: new Date().toISOString(),
    namespace,
    actor,
    data,
    metadata,
  };
}
