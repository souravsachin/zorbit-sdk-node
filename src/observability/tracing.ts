import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

export interface TracingConfig {
  /** Name of the service for tracing */
  serviceName: string;
  /** OTLP collector endpoint URL */
  otlpEndpoint: string;
  /** Service version (optional) */
  serviceVersion?: string;
  /** Additional resource attributes */
  attributes?: Record<string, string>;
}

let sdk: NodeSDK | null = null;

/**
 * Initialize OpenTelemetry tracing with OTLP exporter.
 *
 * Sets up the NodeSDK with auto-instrumentation for HTTP and Express.
 * Call this once at service startup before any other imports.
 *
 * @param config - Tracing configuration
 * @returns The initialized NodeSDK instance
 */
export function initTracing(config: TracingConfig): NodeSDK {
  if (sdk) {
    return sdk;
  }

  const traceExporter = new OTLPTraceExporter({
    url: `${config.otlpEndpoint}/v1/traces`,
  });

  const resourceAttributes: Record<string, string> = {
    [SemanticResourceAttributes.SERVICE_NAME]: config.serviceName,
    ...(config.serviceVersion
      ? { [SemanticResourceAttributes.SERVICE_VERSION]: config.serviceVersion }
      : {}),
    ...config.attributes,
  };

  sdk = new NodeSDK({
    resource: new Resource(resourceAttributes),
    traceExporter,
  });

  sdk.start();

  // Graceful shutdown
  process.on('SIGTERM', () => {
    sdk?.shutdown().catch(console.error);
  });

  return sdk;
}
