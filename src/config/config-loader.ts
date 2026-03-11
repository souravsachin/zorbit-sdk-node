import * as fs from 'fs';
import * as path from 'path';

/**
 * Standard Zorbit platform configuration.
 */
export interface ZorbitConfig {
  /** Service name */
  serviceName: string;
  /** Service port */
  port: number;
  /** Node environment */
  nodeEnv: string;

  /** JWT secret for token validation */
  jwtSecret: string;
  /** JWT issuer */
  jwtIssuer?: string;
  /** JWT audience */
  jwtAudience?: string;

  /** Kafka broker addresses (comma-separated) */
  kafkaBrokers: string[];
  /** Kafka consumer group ID */
  kafkaGroupId?: string;

  /** Authorization service URL */
  authorizationServiceUrl: string;

  /** OTLP endpoint for tracing */
  otlpEndpoint?: string;

  /** Database URL */
  databaseUrl?: string;

  /** Additional custom configuration values */
  [key: string]: unknown;
}

interface ConfigDefinition {
  envVar: string;
  required: boolean;
  default?: string;
  transform?: (value: string) => unknown;
}

const CONFIG_MAP: Record<string, ConfigDefinition> = {
  serviceName: { envVar: 'SERVICE_NAME', required: true },
  port: { envVar: 'PORT', required: false, default: '3000', transform: (v) => parseInt(v, 10) },
  nodeEnv: { envVar: 'NODE_ENV', required: false, default: 'development' },
  jwtSecret: { envVar: 'JWT_SECRET', required: true },
  jwtIssuer: { envVar: 'JWT_ISSUER', required: false },
  jwtAudience: { envVar: 'JWT_AUDIENCE', required: false },
  kafkaBrokers: { envVar: 'KAFKA_BROKERS', required: false, default: 'localhost:9092', transform: (v) => v.split(',').map((b) => b.trim()) },
  kafkaGroupId: { envVar: 'KAFKA_GROUP_ID', required: false },
  authorizationServiceUrl: { envVar: 'AUTHORIZATION_SERVICE_URL', required: false, default: 'http://localhost:3002' },
  otlpEndpoint: { envVar: 'OTLP_ENDPOINT', required: false },
  databaseUrl: { envVar: 'DATABASE_URL', required: false },
};

/**
 * Parse a .env file and load its values into process.env.
 * Does not overwrite existing environment variables.
 */
function loadEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1).trim();

    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Don't overwrite existing env vars
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * Load Zorbit platform configuration from environment variables.
 *
 * Supports .env files (loaded from the current working directory).
 * Environment variables take precedence over .env file values.
 *
 * @param overrides - Optional overrides for specific config values
 * @returns Typed configuration object
 * @throws Error if required configuration values are missing
 */
export function loadConfig(overrides?: Partial<ZorbitConfig>): ZorbitConfig {
  // Load .env file
  loadEnvFile(path.resolve(process.cwd(), '.env'));

  const missing: string[] = [];
  const config: Record<string, unknown> = {};

  for (const [key, def] of Object.entries(CONFIG_MAP)) {
    // Check overrides first
    if (overrides && key in overrides) {
      config[key] = overrides[key];
      continue;
    }

    const value = process.env[def.envVar] ?? def.default;

    if (value === undefined) {
      if (def.required) {
        missing.push(`${def.envVar} (${key})`);
      }
      continue;
    }

    config[key] = def.transform ? def.transform(value) : value;
  }

  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }

  return config as unknown as ZorbitConfig;
}
