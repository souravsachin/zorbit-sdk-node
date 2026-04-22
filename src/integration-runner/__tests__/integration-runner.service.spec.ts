/**
 * Unit tests for IntegrationRunnerService.
 *
 * Covers:
 *   - Happy path: executor resolves, run succeeds, events stream, audit called
 *   - Failure path: executor throws, run status=failed, audit.emitRunFailed called
 *   - Secrets resolution: SecretsResolver invoked for secretRef fields before
 *     executor invocation (when resolver is wired in — see note below)
 *   - SSE event ordering: start → progress × N → complete (or failed)
 *   - Multi-tenant: two runs with different JWT orgIds never cross-contaminate
 *     their event streams
 *   - Idempotency: current behavior (auto-generated runIds per trigger) is
 *     documented; caller-provided-runId idempotency is a follow-up and is
 *     marked skip.
 *
 * Added 2026-04-22 by Soldier BB (task 3).
 */
import {
  AdapterDescriptor,
  AdapterExecutor,
  AuditSink,
  IntegrationRunEvent,
  IntegrationRunInput,
  IntegrationRunResult,
  IntegrationRunStore,
  SecretsResolver,
} from '../types';
import { IntegrationRunnerService } from '../integration-runner.service';

// ---------- Test doubles -----------------------------------------------------

class InMemoryStore implements IntegrationRunStore {
  adapters = new Map<string, AdapterDescriptor>();
  runs = new Map<string, IntegrationRunResult>();

  async getAdapter(code: string): Promise<AdapterDescriptor | null> {
    return this.adapters.get(code) ?? null;
  }

  async createRun(
    run: Omit<IntegrationRunResult, 'events'>,
  ): Promise<IntegrationRunResult> {
    const stored: IntegrationRunResult = { ...run, events: [] };
    this.runs.set(run.runId, stored);
    return stored;
  }

  async updateRun(
    runId: string,
    patch: Partial<IntegrationRunResult>,
  ): Promise<IntegrationRunResult | null> {
    const existing = this.runs.get(runId);
    if (!existing) return null;
    const next = { ...existing, ...patch };
    this.runs.set(runId, next);
    return next;
  }

  async appendEvent(runId: string, event: IntegrationRunEvent): Promise<void> {
    const run = this.runs.get(runId);
    if (run) {
      run.events = [...(run.events ?? []), event];
    }
  }

  async getRun(runId: string): Promise<IntegrationRunResult | null> {
    return this.runs.get(runId) ?? null;
  }
}

class RecordingAudit implements AuditSink {
  started: IntegrationRunResult[] = [];
  completed: IntegrationRunResult[] = [];
  failed: IntegrationRunResult[] = [];

  async emitRunStarted(run: IntegrationRunResult): Promise<void> {
    this.started.push({ ...run });
  }
  async emitRunCompleted(run: IntegrationRunResult): Promise<void> {
    this.completed.push({ ...run });
  }
  async emitRunFailed(run: IntegrationRunResult): Promise<void> {
    this.failed.push({ ...run });
  }
}

function happyExecutor(progressMessages: string[] = ['step-1', 'step-2']): AdapterExecutor {
  return {
    kind: 'rpa',
    async execute(_desc, input, emit) {
      for (const msg of progressMessages) {
        emit({ level: 'info', message: msg });
      }
      return { echoed: input.payload ?? null };
    },
  };
}

function throwingExecutor(message = 'portal_login_failed'): AdapterExecutor {
  return {
    kind: 'rpa',
    async execute(_desc, _input, emit) {
      emit({ level: 'warn', message: 'captcha detected' });
      throw new Error(message);
    },
  };
}

/**
 * Wait for the async background executeRun to finish. The service's
 * `trigger()` returns immediately after createRun — it does not await the
 * run. We wait on the completion emitter.
 */
async function waitForCompletion(
  runner: IntegrationRunnerService,
  runId: string,
): Promise<IntegrationRunResult> {
  return new Promise((resolve) => {
    const unsub = runner.subscribeCompletion(runId, (run) => {
      unsub();
      resolve(run);
    });
  });
}

// ---------- Setup helper -----------------------------------------------------

function buildRunner(opts: {
  executor?: AdapterExecutor;
  secrets?: SecretsResolver;
  audit?: AuditSink;
  adapterOverrides?: Partial<AdapterDescriptor>;
} = {}): {
  runner: IntegrationRunnerService;
  store: InMemoryStore;
  audit: RecordingAudit;
} {
  const store = new InMemoryStore();
  const adapter: AdapterDescriptor = {
    code: 'dic-portal',
    displayName: 'DIC Portal',
    kind: 'rpa',
    targetUrl: 'https://portal.example.com',
    authType: 'portal_login',
    config: { selectors: { username: '#u' } },
    enabled: true,
    ...opts.adapterOverrides,
  };
  store.adapters.set(adapter.code, adapter);
  const audit = (opts.audit as RecordingAudit) ?? new RecordingAudit();
  const runner = new IntegrationRunnerService({
    store,
    executors: [opts.executor ?? happyExecutor()],
    secrets: opts.secrets,
    audit,
    runIdPrefix: 'RUN',
  });
  return { runner, store, audit };
}

// ---------- Tests ------------------------------------------------------------

describe('IntegrationRunnerService — happy path', () => {
  it('completes a run, streams events, persists result, and calls audit.started + audit.completed', async () => {
    const { runner, store, audit } = buildRunner({
      executor: happyExecutor(['step-login', 'step-scrape']),
    });

    const input: IntegrationRunInput = {
      adapterCode: 'dic-portal',
      trigger: 'manual',
      payload: { dryRun: true },
      actor: { userHashId: 'U-USER', organizationHashId: 'O-ORG1' },
    };

    const captured: IntegrationRunEvent[] = [];
    const triggerResult = await runner.trigger(input);
    runner.subscribe(triggerResult.runId, (e) => captured.push(e));

    const completion = await waitForCompletion(runner, triggerResult.runId);

    expect(completion.status).toBe('succeeded');
    expect(completion.result).toEqual({ echoed: { dryRun: true } });
    expect(completion.completedAt).toBeInstanceOf(Date);
    expect(audit.started).toHaveLength(1);
    expect(audit.completed).toHaveLength(1);
    expect(audit.failed).toHaveLength(0);

    // Store persisted the same terminal row
    const persisted = await store.getRun(triggerResult.runId);
    expect(persisted?.status).toBe('succeeded');
    // All events appended to the store
    expect((persisted?.events ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe('IntegrationRunnerService — failure path', () => {
  it('records failure, captures error message, and calls audit.failed (not completed)', async () => {
    const { runner, store, audit } = buildRunner({
      executor: throwingExecutor('TIMEOUT waiting for captcha'),
    });

    const triggered = await runner.trigger({
      adapterCode: 'dic-portal',
      trigger: 'manual',
    });
    const completion = await waitForCompletion(runner, triggered.runId);

    expect(completion.status).toBe('failed');
    expect(completion.errorMessage).toBe('TIMEOUT waiting for captcha');
    expect(completion.completedAt).toBeInstanceOf(Date);
    expect(audit.started).toHaveLength(1);
    expect(audit.completed).toHaveLength(0);
    expect(audit.failed).toHaveLength(1);

    const persisted = await store.getRun(triggered.runId);
    expect(persisted?.status).toBe('failed');
    expect(persisted?.errorMessage).toBe('TIMEOUT waiting for captcha');
  });

  it('throws synchronously if adapter is unknown', async () => {
    const { runner } = buildRunner();
    await expect(
      runner.trigger({ adapterCode: 'nonexistent', trigger: 'manual' }),
    ).rejects.toThrow(/Adapter not found/);
  });

  it('throws synchronously if adapter is disabled', async () => {
    const { runner } = buildRunner({ adapterOverrides: { enabled: false } });
    await expect(
      runner.trigger({ adapterCode: 'dic-portal', trigger: 'manual' }),
    ).rejects.toThrow(/disabled/);
  });

  it('throws synchronously if no executor is registered for adapter.kind', async () => {
    const store = new InMemoryStore();
    store.adapters.set('weird', {
      code: 'weird',
      displayName: 'Weird',
      kind: 'sftp',
      enabled: true,
    });
    const runner = new IntegrationRunnerService({
      store,
      executors: [happyExecutor()], // kind: 'rpa'
    });
    await expect(
      runner.trigger({ adapterCode: 'weird', trigger: 'manual' }),
    ).rejects.toThrow(/No executor registered/);
  });
});

describe('IntegrationRunnerService — secrets resolution', () => {
  /**
   * The current primitive invokes executor.execute(adapter, input, emit) — it
   * does not itself resolve a secretRef and mutate the adapter config. That
   * logic lives in the executor implementation (executor pulls from
   * `deps.secrets` via a closure at module wiring).
   *
   * These tests verify:
   *  (a) if an executor elects to pull from SecretsResolver, it can
   *  (b) the runner does not spuriously call resolver itself (no side effects
   *      for executors that do not use it)
   */
  it('runner does NOT call resolver itself — secret resolution is an executor concern', async () => {
    const resolve = jest.fn();
    const { runner } = buildRunner({
      secrets: { resolve },
    });
    const triggered = await runner.trigger({
      adapterCode: 'dic-portal',
      trigger: 'manual',
    });
    await waitForCompletion(runner, triggered.runId);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('an executor that pulls from the resolver receives resolved credentials before work', async () => {
    const resolve = jest.fn().mockResolvedValue({ username: 'demo', password: 'pw' });
    const store = new InMemoryStore();
    const adapter: AdapterDescriptor = {
      code: 'portal',
      displayName: 'Portal',
      kind: 'rpa',
      enabled: true,
      config: { secretRef: 'platform.portal.credentials' },
    };
    store.adapters.set(adapter.code, adapter);

    const callOrder: string[] = [];
    const executor: AdapterExecutor = {
      kind: 'rpa',
      async execute(desc, _input, emit) {
        const secretRef = (desc.config as any)?.secretRef as string | undefined;
        if (secretRef) {
          callOrder.push('before-resolve');
          const creds = await resolve(secretRef, 'jwt-token');
          callOrder.push(`resolved:${creds.username}`);
          emit({ level: 'info', message: `logged in as ${creds.username}` });
        }
        callOrder.push('execute-body');
        return { ok: true };
      },
    };
    const runner = new IntegrationRunnerService({ store, executors: [executor] });

    const triggered = await runner.trigger({
      adapterCode: 'portal',
      trigger: 'manual',
    });
    const completion = await waitForCompletion(runner, triggered.runId);

    expect(resolve).toHaveBeenCalledWith('platform.portal.credentials', 'jwt-token');
    expect(callOrder).toEqual(['before-resolve', 'resolved:demo', 'execute-body']);
    expect(completion.status).toBe('succeeded');
  });
});

describe('IntegrationRunnerService — SSE event ordering', () => {
  it('emits start-info → executor-progress (×N) → terminal success-info and then completed', async () => {
    const { runner } = buildRunner({
      executor: happyExecutor(['working', 'working-2', 'working-3']),
    });

    const triggered = await runner.trigger({
      adapterCode: 'dic-portal',
      trigger: 'manual',
    });

    const events: IntegrationRunEvent[] = [];
    runner.subscribe(triggered.runId, (e) => events.push(e));
    const completion = await waitForCompletion(runner, triggered.runId);

    // Expected order: start-info, step-*, final success
    expect(events.length).toBe(5); // 1 start + 3 progress + 1 success
    expect(events[0].level).toBe('info');
    expect(events[0].message).toMatch(/started/);
    expect(events.slice(1, 4).map((e) => e.message)).toEqual(['working', 'working-2', 'working-3']);
    expect(events[4].level).toBe('info');
    expect(events[4].message).toMatch(/succeeded/);

    // Terminal completion event fires after all events have been emitted
    expect(completion.status).toBe('succeeded');

    // Monotonic timestamps (non-decreasing)
    for (let i = 1; i < events.length; i++) {
      expect(events[i].timestamp.getTime()).toBeGreaterThanOrEqual(events[i - 1].timestamp.getTime());
    }
  });

  it('on failure, emits start → progress → error event, and terminal completion carries failure', async () => {
    const { runner } = buildRunner({
      executor: throwingExecutor('boom'),
    });
    const triggered = await runner.trigger({
      adapterCode: 'dic-portal',
      trigger: 'manual',
    });
    const events: IntegrationRunEvent[] = [];
    runner.subscribe(triggered.runId, (e) => events.push(e));
    const completion = await waitForCompletion(runner, triggered.runId);

    const levels = events.map((e) => e.level);
    // Order: [start=info, warn (from throwingExecutor), error]
    expect(levels[0]).toBe('info');
    expect(levels[levels.length - 1]).toBe('error');
    expect(events[events.length - 1].message).toMatch(/failed: boom/);
    expect(completion.status).toBe('failed');
  });
});

describe('IntegrationRunnerService — multi-tenant isolation', () => {
  it('two runs for different orgs do not cross-contaminate event streams', async () => {
    const { runner } = buildRunner({
      executor: happyExecutor(['scrape-for-org']),
    });

    const runA = await runner.trigger({
      adapterCode: 'dic-portal',
      trigger: 'manual',
      actor: { userHashId: 'U-A', organizationHashId: 'O-AAA' },
    });
    const runB = await runner.trigger({
      adapterCode: 'dic-portal',
      trigger: 'manual',
      actor: { userHashId: 'U-B', organizationHashId: 'O-BBB' },
    });

    const eventsA: IntegrationRunEvent[] = [];
    const eventsB: IntegrationRunEvent[] = [];
    runner.subscribe(runA.runId, (e) => eventsA.push(e));
    runner.subscribe(runB.runId, (e) => eventsB.push(e));

    await Promise.all([
      waitForCompletion(runner, runA.runId),
      waitForCompletion(runner, runB.runId),
    ]);

    expect(eventsA.length).toBeGreaterThan(0);
    expect(eventsB.length).toBeGreaterThan(0);
    // No event message should mention the other run's id
    for (const e of eventsA) {
      expect(e.message).not.toContain(runB.runId);
    }
    for (const e of eventsB) {
      expect(e.message).not.toContain(runA.runId);
    }
  });

  it('distinct runs get distinct runIds (auto-generated)', async () => {
    const { runner } = buildRunner();
    const r1 = await runner.trigger({ adapterCode: 'dic-portal', trigger: 'manual' });
    const r2 = await runner.trigger({ adapterCode: 'dic-portal', trigger: 'manual' });
    expect(r1.runId).not.toEqual(r2.runId);
    expect(r1.runId).toMatch(/^RUN-[0-9A-F]{4}$/);
  });
});

describe('IntegrationRunnerService — idempotency (current + follow-up)', () => {
  it('two calls with identical input produce two distinct runs under the current contract', async () => {
    // Documents CURRENT behaviour: `trigger()` always creates a fresh run.
    // This is NOT the caller-provided-runId idempotency the integration
    // spec eventually calls for — see the `.skip` test below.
    const { runner, store } = buildRunner();

    const input: IntegrationRunInput = {
      adapterCode: 'dic-portal',
      trigger: 'manual',
      payload: { requestId: 'client-REQ-1' },
    };
    const r1 = await runner.trigger(input);
    const r2 = await runner.trigger(input);

    await Promise.all([
      waitForCompletion(runner, r1.runId),
      waitForCompletion(runner, r2.runId),
    ]);

    expect(r1.runId).not.toBe(r2.runId);
    expect(store.runs.size).toBe(2);
  });

  it.skip('[future] caller-provided runId collapses duplicate triggers to a single run', async () => {
    // Phase-2 feature: the runner should dedupe by caller-provided idempotencyKey
    // or explicit runId. Once implemented, invoking trigger() twice with the same
    // key should return the same runId and NOT create a second store row.
    // Kept as a living pending test so the requirement isn't lost.
  });
});
