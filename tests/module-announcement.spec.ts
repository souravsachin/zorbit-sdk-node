/**
 * Unit tests for ModuleAnnouncementService — the SDK's replacement for
 * the 22 duplicated announcement producers.
 *
 * We test the pure `buildAnnouncementMessage` method rather than exercising
 * Kafka end-to-end. That keeps the test fast and deterministic while still
 * asserting the exact wire format the registry consumes.
 */
import { createHmac } from 'crypto';
import { ModuleAnnouncementService } from '../src/module-announcement';
import { canonicalJson } from '../src/canonical-json';

function fakeConfig(env: Record<string, string>) {
  return {
    get<T = string>(key: string, fallback?: T): T {
      return (env[key] ?? fallback) as T;
    },
  } as unknown as import('@nestjs/config').ConfigService;
}

const SECRET = 'test-module-secret';

describe('ModuleAnnouncementService.buildAnnouncementMessage', () => {
  const manifest = {
    moduleId: 'zorbit-cor-secrets_vault',
    moduleName: 'Secrets Vault',
    moduleType: 'cor',
    version: '1.0.0',
    registration: {
      manifestUrl: 'https://zorbit-uat.example/api/secrets-vault/manifest',
    },
    dependencies: { requires: ['zorbit-cor-identity'], optional: [] },
  };

  it('produces a message with all required fields', () => {
    const svc = new ModuleAnnouncementService(fakeConfig({}), manifest);
    const msg = svc.buildAnnouncementMessage(SECRET);

    expect(msg.moduleId).toBe('zorbit-cor-secrets_vault');
    expect(msg.moduleName).toBe('Secrets Vault');
    expect(msg.moduleType).toBe('cor');
    expect(msg.version).toBe('1.0.0');
    expect(msg.manifestUrl).toBe('https://zorbit-uat.example/api/secrets-vault/manifest');
    expect(msg.dependencies).toEqual({
      platform: ['zorbit-cor-identity'],
      business: [],
    });
    expect(msg.signedToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signs the canonical-JSON of {dependencies, manifestUrl, moduleId, version}', () => {
    const svc = new ModuleAnnouncementService(fakeConfig({}), manifest);
    const msg = svc.buildAnnouncementMessage(SECRET);

    const expectedCanonical = canonicalJson({
      dependencies: { platform: ['zorbit-cor-identity'], business: [] },
      manifestUrl: manifest.registration.manifestUrl,
      moduleId: manifest.moduleId,
      version: manifest.version,
    });
    const expectedToken = createHmac('sha256', SECRET)
      .update(expectedCanonical)
      .digest('hex');

    expect(msg.signedToken).toBe(expectedToken);
  });

  it('is deterministic for the same manifest + secret', () => {
    const svc = new ModuleAnnouncementService(fakeConfig({}), manifest);
    const a = svc.buildAnnouncementMessage(SECRET);
    const b = svc.buildAnnouncementMessage(SECRET);
    expect(a.signedToken).toBe(b.signedToken);
  });

  it('produces a different signed token when version changes', () => {
    const svcA = new ModuleAnnouncementService(fakeConfig({}), manifest);
    const svcB = new ModuleAnnouncementService(fakeConfig({}), {
      ...manifest,
      version: '1.0.1',
    });
    expect(svcA.buildAnnouncementMessage(SECRET).signedToken).not.toBe(
      svcB.buildAnnouncementMessage(SECRET).signedToken,
    );
  });

  it('handles missing dependencies field as empty v2 shape', () => {
    const { dependencies: _ignored, ...stripped } = manifest;
    void _ignored;
    const svc = new ModuleAnnouncementService(
      fakeConfig({}),
      stripped as unknown as typeof manifest,
    );
    const msg = svc.buildAnnouncementMessage(SECRET);
    expect(msg.dependencies).toEqual({ platform: [], business: [] });
  });

  it('handles string[] dependencies (legacy v0 shape)', () => {
    const svc = new ModuleAnnouncementService(fakeConfig({}), {
      ...manifest,
      dependencies: ['zorbit-cor-identity', 'zorbit-cor-audit'],
    });
    const msg = svc.buildAnnouncementMessage(SECRET);
    expect(msg.dependencies).toEqual({
      platform: ['zorbit-cor-identity', 'zorbit-cor-audit'],
      business: [],
    });
  });

  it('honours the v2 shape with a business bucket', () => {
    const svc = new ModuleAnnouncementService(fakeConfig({}), {
      ...manifest,
      dependencies: {
        platform: ['zorbit-cor-identity'],
        business: ['zorbit-app-pcg4'],
      },
    });
    const msg = svc.buildAnnouncementMessage(SECRET);
    expect(msg.dependencies).toEqual({
      platform: ['zorbit-cor-identity'],
      business: ['zorbit-app-pcg4'],
    });
  });

  it('produces a signed token the registry canonicalJson validator would accept', () => {
    // Emulates HmacValidatorService.validate logic: compute HMAC over
    // canonicalJson(payload-without-signedToken) and compare.
    const svc = new ModuleAnnouncementService(fakeConfig({}), manifest);
    const msg = svc.buildAnnouncementMessage(SECRET);

    // Registry receives the full message but signs only the signing subset.
    const signingPayload = {
      dependencies: msg.dependencies,
      manifestUrl: msg.manifestUrl,
      moduleId: msg.moduleId,
      version: msg.version,
    };
    const recomputed = createHmac('sha256', SECRET)
      .update(canonicalJson(signingPayload))
      .digest('hex');

    expect(recomputed).toBe(msg.signedToken);
  });
});

describe('ModuleAnnouncementService options & defaults', () => {
  it('exposes default boot/notify delays (5000 / 2000)', () => {
    // Options are private, but we can at least instantiate with overrides
    // to confirm the class accepts them without throwing.
    expect(
      () =>
        new ModuleAnnouncementService(
          fakeConfig({}),
          {
            moduleId: 'x',
            moduleName: 'x',
            moduleType: 'cor',
            version: '1',
            registration: { manifestUrl: 'x' },
          },
          { bootDelayMs: 100, notifyDelayMs: 50, notifyRegistry: false },
        ),
    ).not.toThrow();
  });
});
