/**
 * Integration Runner — shared primitive for orchestrating adapter-based integration runs
 * (RPA, API, SOAP, SFTP, DB, etc.).
 *
 * Ported pattern from RPAg4. Portal-agnostic: all portal-specific behavior is parameterised.
 */

export type IntegrationRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface AdapterDescriptor {
  /** Adapter short code (unique within a module) */
  code: string;

  /** Display name */
  displayName: string;

  /** What kind of adapter: rpa | api | soap | sftp | database */
  kind: string;

  /** Target portal or API base URL */
  targetUrl?: string;

  /** Auth type: basic, oauth2, jwt, api_key, portal_login, mtls, etc. */
  authType?: string;

  /** Arbitrary adapter config (portal selectors, API schema, etc.) */
  config?: Record<string, unknown>;

  /** Whether enabled */
  enabled?: boolean;
}

export interface IntegrationRunInput {
  adapterCode: string;
  trigger: 'manual' | 'scheduled' | 'event' | 'api';
  payload?: Record<string, unknown>;
  /** Actor performing the run (from JWT) */
  actor?: {
    userHashId?: string;
    organizationHashId?: string;
  };
}

export interface IntegrationRunResult {
  runId: string;
  adapterCode: string;
  status: IntegrationRunStatus;
  startedAt: Date;
  completedAt?: Date;
  result?: unknown;
  errorMessage?: string;
  events?: IntegrationRunEvent[];
}

export interface IntegrationRunEvent {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Adapter executor contract — each adapter implementation (RPA script, API caller, SOAP client)
 * implements this. The runner does not know about Playwright/axios details; it just invokes.
 */
export interface AdapterExecutor {
  /** Identifies the adapter this executor handles */
  readonly kind: string;

  /**
   * Execute a run. Must return a result object or throw. Implementation
   * should call `emitEvent` to stream SSE updates.
   */
  execute(
    descriptor: AdapterDescriptor,
    input: IntegrationRunInput,
    emitEvent: (event: Omit<IntegrationRunEvent, 'timestamp'>) => void,
  ): Promise<unknown>;
}

/**
 * Storage contract — persists adapters and runs. Implemented by each module using its own DB
 * (TypeORM, Mongoose, etc.).
 */
export interface IntegrationRunStore {
  getAdapter(code: string): Promise<AdapterDescriptor | null>;
  createRun(run: Omit<IntegrationRunResult, 'events'>): Promise<IntegrationRunResult>;
  updateRun(
    runId: string,
    patch: Partial<IntegrationRunResult>,
  ): Promise<IntegrationRunResult | null>;
  appendEvent(runId: string, event: IntegrationRunEvent): Promise<void>;
  getRun(runId: string): Promise<IntegrationRunResult | null>;
}

/**
 * Optional secrets provider — resolves `secretRef` strings to actual credentials
 * (from zorbit-cor-secrets_vault). If not provided, credentials are expected inline
 * in adapter.config (dev-only).
 */
export interface SecretsResolver {
  resolve(secretRef: string, jwt?: string): Promise<Record<string, string>>;
}

/**
 * Optional audit publisher — emits run lifecycle events to zorbit-audit (Kafka).
 */
export interface AuditSink {
  emitRunStarted(run: IntegrationRunResult): Promise<void>;
  emitRunCompleted(run: IntegrationRunResult): Promise<void>;
  emitRunFailed(run: IntegrationRunResult): Promise<void>;
}
