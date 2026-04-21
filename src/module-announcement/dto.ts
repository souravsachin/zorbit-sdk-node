import { DependenciesV2 } from '../dependencies';

/**
 * The minimal subset of a Zorbit module manifest required to announce
 * the module to zorbit-cor-module_registry.
 *
 * Producers pass their own manifest (loaded from
 * `zorbit-module-manifest.json`) into the announcement service; only
 * these fields are read.
 */
export interface ModuleManifestAnnouncementFields {
  /** e.g. 'zorbit-cor-secrets_vault' */
  moduleId: string;
  /** Human-readable module name */
  moduleName: string;
  /** Module type: 'cor' | 'pfs' | 'app' | 'adm' | 'ai' | ... */
  moduleType: string;
  /** Semantic version, e.g. '1.0.0' */
  version: string;
  /** Registration metadata (manifestUrl is the only required field) */
  registration: {
    manifestUrl: string;
  };
  /** Dependency declaration in any supported shape (will be normalised) */
  dependencies?: unknown;
}

/**
 * The Kafka payload published to `platform-module-announcements`.
 * Consumed by zorbit-cor-module_registry's announcement consumer.
 */
export interface ModuleAnnouncementMessage {
  moduleId: string;
  moduleName: string;
  moduleType: string;
  version: string;
  manifestUrl: string;
  dependencies: DependenciesV2;
  /** HMAC-SHA256 of canonicalJson({dependencies,manifestUrl,moduleId,version}) */
  signedToken: string;
}

/**
 * Options that a consuming service may override when instantiating
 * `ModuleAnnouncementService`. Every field has a safe default.
 */
export interface ModuleAnnouncementOptions {
  /** Kafka topic. Default: 'platform-module-announcements' */
  topic?: string;
  /** Delay in ms between app bootstrap and Kafka announce. Default: 5000 */
  bootDelayMs?: number;
  /** Delay in ms between Kafka announce and nav-cache notify. Default: 2000 */
  notifyDelayMs?: number;
  /** Whether to POST nav-cache notify to registry. Default: true */
  notifyRegistry?: boolean;
  /** Fallback module registry URL if not set via env. Default: 'http://zu-module_registry:3036' */
  moduleRegistryUrlDefault?: string;
  /** Fallback Kafka brokers if not set via env. Default: 'zs-kafka:9092' */
  kafkaBrokersDefault?: string;
  /** Fallback PLATFORM_MODULE_SECRET. Default: 'dev-secret' */
  moduleSecretDefault?: string;
}
