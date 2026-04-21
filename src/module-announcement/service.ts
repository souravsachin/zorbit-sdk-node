import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';
import axios from 'axios';
import { canonicalJson } from '../canonical-json';
import { normaliseDependenciesV2 } from '../dependencies';
import {
  ModuleManifestAnnouncementFields,
  ModuleAnnouncementMessage,
  ModuleAnnouncementOptions,
} from './dto';
import { createHmac } from 'crypto';

/**
 * Self-announces a Zorbit module to zorbit-cor-module_registry via Kafka
 * (topic: platform-module-announcements) with an HMAC-SHA256 signature
 * derived from PLATFORM_MODULE_SECRET.
 *
 * This SDK service subsumes the announcement code that was previously
 * duplicated across 22 backend services. It bakes in three Phase-1
 * learnings:
 *
 *   1. Boot race — delays the Kafka announce by 5s after
 *      onApplicationBootstrap so NestJS route mapping completes before the
 *      registry's manifest fetch hits the service. Prevents registry
 *      caching a partial manifest.
 *
 *   2. HMAC contract — signs the canonical-JSON of
 *      `{dependencies, manifestUrl, moduleId, version}` where
 *      `dependencies` is the v2 object shape. Recursive-sort canonical JSON
 *      matches the registry's HmacValidatorService byte-for-byte.
 *
 *   3. Nav-cache race — 2s after the Kafka announce, POSTs to the
 *      registry's notifications endpoint so the nav cache refreshes
 *      without a second container restart.
 *
 * Kafka/HTTP failures are non-fatal — the service will log a warning and
 * continue. This prevents module-registry outages from blocking other
 * service boots.
 *
 * @example
 *   // In your service's EventsModule:
 *   @Module({
 *     providers: [
 *       {
 *         provide: ModuleAnnouncementService,
 *         useFactory: (config: ConfigService) => {
 *           const manifest = require('../../zorbit-module-manifest.json');
 *           return new ModuleAnnouncementService(config, manifest);
 *         },
 *         inject: [ConfigService],
 *       },
 *     ],
 *   })
 *   export class EventsModule {}
 */
@Injectable()
export class ModuleAnnouncementService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ModuleAnnouncementService.name);
  private producer?: Producer;
  private readonly opts: Required<ModuleAnnouncementOptions>;

  constructor(
    private readonly config: ConfigService,
    private readonly manifest: ModuleManifestAnnouncementFields,
    options: ModuleAnnouncementOptions = {},
  ) {
    this.opts = {
      topic: options.topic ?? 'platform-module-announcements',
      bootDelayMs: options.bootDelayMs ?? 5_000,
      notifyDelayMs: options.notifyDelayMs ?? 2_000,
      notifyRegistry: options.notifyRegistry ?? true,
      moduleRegistryUrlDefault:
        options.moduleRegistryUrlDefault ?? 'http://zu-module_registry:3036',
      kafkaBrokersDefault: options.kafkaBrokersDefault ?? 'zs-kafka:9092',
      moduleSecretDefault: options.moduleSecretDefault ?? 'dev-secret',
    };
  }

  async onApplicationBootstrap(): Promise<void> {
    // Fire-and-forget; don't block bootstrap.
    setTimeout(() => {
      this.announce().catch((err) => {
        this.logger.warn(
          `Module announcement round failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }, this.opts.bootDelayMs);
  }

  /**
   * Build the signed Kafka message for the current manifest.
   * Exposed as a method (not just a private helper) so unit tests can
   * assert on the exact wire format without spinning up Kafka.
   */
  buildAnnouncementMessage(secret: string): ModuleAnnouncementMessage {
    const dependencies = normaliseDependenciesV2(this.manifest.dependencies);
    const manifestUrl = this.manifest.registration.manifestUrl;
    const version = this.manifest.version;
    const moduleId = this.manifest.moduleId;

    // Canonical JSON: recursive key-sort, no whitespace.
    const payloadForSigning = {
      dependencies,
      manifestUrl,
      moduleId,
      version,
    };
    const canonical = canonicalJson(payloadForSigning);
    const signedToken = createHmac('sha256', secret).update(canonical).digest('hex');

    return {
      moduleId,
      moduleName: this.manifest.moduleName,
      moduleType: this.manifest.moduleType,
      version,
      manifestUrl,
      dependencies,
      signedToken,
    };
  }

  /**
   * Execute one announcement round: connect to Kafka, publish, disconnect.
   * Public so tests and admin endpoints can trigger a re-announcement
   * on demand (useful after manifest edits).
   */
  async announce(): Promise<void> {
    const brokers = this.config
      .get<string>('KAFKA_BROKERS', this.opts.kafkaBrokersDefault)
      .split(',');
    const kafka = new Kafka({ clientId: this.manifest.moduleId, brokers });
    this.producer = kafka.producer();

    try {
      await this.producer.connect();
      await this.publish();
      await this.producer.disconnect();
    } catch (err) {
      this.logger.warn(
        'Module announcement failed (non-fatal): ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }

    if (this.opts.notifyRegistry) {
      setTimeout(() => {
        this.notifyRegistry().catch((err) => {
          this.logger.warn(
            `Nav-cache notify failed (non-fatal): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
      }, this.opts.notifyDelayMs);
    }
  }

  private async publish(): Promise<void> {
    if (!this.producer) {
      throw new Error('Kafka producer not connected');
    }
    const secret = this.config.get<string>(
      'PLATFORM_MODULE_SECRET',
      this.opts.moduleSecretDefault,
    );
    const message = this.buildAnnouncementMessage(secret);

    await this.producer.send({
      topic: this.opts.topic,
      messages: [{ key: message.moduleId, value: JSON.stringify(message) }],
    });

    this.logger.log(
      `Module announcement published for ${message.moduleId} v${message.version}`,
    );
  }

  /**
   * Best-effort POST to module-registry's notifications endpoint to
   * refresh nav-cache subscribers. Silent on failure.
   */
  private async notifyRegistry(): Promise<void> {
    const base = this.config.get<string>(
      'MODULE_REGISTRY_INTERNAL_URL',
      this.opts.moduleRegistryUrlDefault,
    );
    const url = `${base}/api/v1/G/modules/${this.manifest.moduleId}/notifications`;
    try {
      const res = await axios.post(
        url,
        {},
        { timeout: 3000, validateStatus: () => true },
      );
      if (res.status >= 200 && res.status < 300) {
        this.logger.log(`Nav-cache notify sent to registry → ${res.status}`);
      } else {
        this.logger.warn(`Nav-cache notify got ${res.status} from ${url}`);
      }
    } catch (err) {
      this.logger.warn(
        `Nav-cache notify error ${url}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
