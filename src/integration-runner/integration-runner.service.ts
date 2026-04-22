import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';
import {
  AdapterDescriptor,
  AdapterExecutor,
  AuditSink,
  IntegrationRunEvent,
  IntegrationRunInput,
  IntegrationRunResult,
  IntegrationRunStore,
  SecretsResolver,
} from './types';

export interface IntegrationRunnerDeps {
  store: IntegrationRunStore;
  executors: AdapterExecutor[];
  secrets?: SecretsResolver;
  audit?: AuditSink;
  runIdPrefix?: string;
}

/**
 * Framework-agnostic runner. Wraps:
 *
 *   1. resolve adapter descriptor from store
 *   2. optionally resolve credentials from secrets vault
 *   3. pick executor for adapter.kind
 *   4. execute with event streaming
 *   5. persist run lifecycle + events
 *   6. audit
 *
 * Event streaming exposed via EventEmitter (one emitter per runner instance; listeners
 * filter by runId).
 */
export class IntegrationRunnerService {
  private readonly emitter = new EventEmitter();
  private readonly executorsByKind: Map<string, AdapterExecutor>;
  private readonly runIdPrefix: string;

  constructor(private readonly deps: IntegrationRunnerDeps) {
    this.executorsByKind = new Map(deps.executors.map((e) => [e.kind, e]));
    this.runIdPrefix = deps.runIdPrefix ?? 'RUN';
    this.emitter.setMaxListeners(0);
  }

  /** Subscribe to events for a specific run (for SSE streaming). */
  subscribe(
    runId: string,
    listener: (event: IntegrationRunEvent) => void,
  ): () => void {
    const handler = (payload: { runId: string; event: IntegrationRunEvent }) => {
      if (payload.runId === runId) listener(payload.event);
    };
    this.emitter.on('event', handler);
    return () => this.emitter.off('event', handler);
  }

  /** Subscribe to terminal events (completed/failed/cancelled). */
  subscribeCompletion(
    runId: string,
    listener: (run: IntegrationRunResult) => void,
  ): () => void {
    const handler = (payload: { runId: string; run: IntegrationRunResult }) => {
      if (payload.runId === runId) listener(payload.run);
    };
    this.emitter.on('completed', handler);
    return () => this.emitter.off('completed', handler);
  }

  /** Generate a short run ID like RUN-A1B2. */
  private generateRunId(): string {
    const hash = randomBytes(2).toString('hex').toUpperCase();
    return `${this.runIdPrefix}-${hash}`;
  }

  /**
   * Trigger a run. Returns the run record (async execution kicked off in background).
   */
  async trigger(input: IntegrationRunInput): Promise<IntegrationRunResult> {
    const adapter = await this.deps.store.getAdapter(input.adapterCode);
    if (!adapter) {
      throw new Error(`Adapter not found: ${input.adapterCode}`);
    }
    if (adapter.enabled === false) {
      throw new Error(`Adapter disabled: ${input.adapterCode}`);
    }
    const executor = this.executorsByKind.get(adapter.kind);
    if (!executor) {
      throw new Error(`No executor registered for kind: ${adapter.kind}`);
    }

    const runId = this.generateRunId();
    const started: IntegrationRunResult = {
      runId,
      adapterCode: adapter.code,
      status: 'queued',
      startedAt: new Date(),
    };
    const created = await this.deps.store.createRun(started);

    // Kick off async execution
    this.executeRun(created, adapter, executor, input).catch((err) => {
      // swallow; already recorded below in executeRun
      // eslint-disable-next-line no-console
      console.error('[integration-runner] unexpected error', err);
    });

    return created;
  }

  private async executeRun(
    run: IntegrationRunResult,
    adapter: AdapterDescriptor,
    executor: AdapterExecutor,
    input: IntegrationRunInput,
  ): Promise<void> {
    const updated: IntegrationRunResult = { ...run, status: 'running' };
    await this.deps.store.updateRun(run.runId, { status: 'running' });
    await this.deps.audit?.emitRunStarted(updated).catch(() => undefined);

    const emitEvent = (e: Omit<IntegrationRunEvent, 'timestamp'>) => {
      const event: IntegrationRunEvent = { ...e, timestamp: new Date() };
      this.deps.store.appendEvent(run.runId, event).catch(() => undefined);
      this.emitter.emit('event', { runId: run.runId, event });
    };

    emitEvent({
      level: 'info',
      message: `Run ${run.runId} started for adapter ${adapter.code}`,
      data: { trigger: input.trigger },
    });

    try {
      const result = await executor.execute(adapter, input, emitEvent);
      const completedAt = new Date();
      const final: IntegrationRunResult = {
        ...run,
        status: 'succeeded',
        completedAt,
        result,
      };
      await this.deps.store.updateRun(run.runId, {
        status: 'succeeded',
        completedAt,
        result,
      });
      emitEvent({
        level: 'info',
        message: `Run ${run.runId} succeeded`,
      });
      await this.deps.audit?.emitRunCompleted(final).catch(() => undefined);
      this.emitter.emit('completed', { runId: run.runId, run: final });
    } catch (err) {
      const completedAt = new Date();
      const message = err instanceof Error ? err.message : String(err);
      const final: IntegrationRunResult = {
        ...run,
        status: 'failed',
        completedAt,
        errorMessage: message,
      };
      await this.deps.store.updateRun(run.runId, {
        status: 'failed',
        completedAt,
        errorMessage: message,
      });
      emitEvent({
        level: 'error',
        message: `Run ${run.runId} failed: ${message}`,
      });
      await this.deps.audit?.emitRunFailed(final).catch(() => undefined);
      this.emitter.emit('completed', { runId: run.runId, run: final });
    }
  }

  async getRun(runId: string): Promise<IntegrationRunResult | null> {
    return this.deps.store.getRun(runId);
  }
}
