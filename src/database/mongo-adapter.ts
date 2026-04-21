import mongoose, { Connection, ConnectOptions } from 'mongoose';
import { PIIDetectorConfig, createPIIDetector } from '../interceptors/pii-detector';
import { AuditLoggerConfig, createAuditLogger } from '../interceptors/audit-logger';

/**
 * Configuration for the MongoDB adapter.
 */
export interface MongoAdapterConfig {
  /** MongoDB connection string */
  uri: string;
  /** Database name */
  dbName: string;
  /** Use directConnection=true (default: true, required for single-node replica sets) */
  directConnection?: boolean;
  /** Optional PII detection config - if provided, save/update hooks will auto-tokenize PII */
  piiDetector?: PIIDetectorConfig;
  /** Optional audit logger config - if provided, save/update/delete hooks publish audit events */
  auditLogger?: AuditLoggerConfig;
  /** Additional Mongoose connection options */
  connectionOptions?: ConnectOptions;
}

/**
 * Ensure directConnection=true is in the connection URI.
 *
 * The server's MongoDB replica set requires directConnection=true
 * for single-node setups. This function ensures it's present.
 */
export function ensureDirectConnection(uri: string, directConnection: boolean = true): string {
  if (!directConnection) return uri;

  const url = new URL(uri);
  if (!url.searchParams.has('directConnection')) {
    url.searchParams.set('directConnection', 'true');
  }
  return url.toString();
}

/**
 * Create a Mongoose connection with directConnection=true and optional
 * PII detection and audit logging hooks.
 *
 * @example
 * ```typescript
 * const connection = await createMongoConnection({
 *   uri: 'mongodb://localhost:27017',
 *   dbName: 'zorbit-datatable',
 *   directConnection: true,
 *   piiDetector: {
 *     piiVaultUrl: 'http://localhost:3105',
 *     orgHashId: 'O-92AF',
 *     enabled: true,
 *   },
 *   auditLogger: {
 *     kafkaBrokers: ['localhost:9092'],
 *     serviceName: 'zorbit-pfs-datatable',
 *   },
 * });
 * ```
 */
export async function createMongoConnection(
  config: MongoAdapterConfig,
): Promise<Connection> {
  const directConnection = config.directConnection !== false;
  const uri = ensureDirectConnection(config.uri, directConnection);

  const options: ConnectOptions = {
    dbName: config.dbName,
    ...config.connectionOptions,
  };

  const connection = mongoose.createConnection(uri, options);

  // Wait for connection to be ready
  await new Promise<void>((resolve, reject) => {
    connection.on('connected', () => resolve());
    connection.on('error', (err) => reject(err));
  });

  // Set up PII detector if configured
  let piiScan: ReturnType<typeof createPIIDetector> | null = null;
  if (config.piiDetector) {
    piiScan = createPIIDetector(config.piiDetector);
  }

  // Set up audit logger if configured
  let auditLogger: ReturnType<typeof createAuditLogger> | null = null;
  if (config.auditLogger) {
    auditLogger = createAuditLogger(config.auditLogger);
    await auditLogger.connect();
  }

  // Apply middleware hooks to all schemas registered on this connection
  connection.plugin((schema) => {
    // Pre-save hook: PII detection
    if (piiScan) {
      const detector = piiScan;
      schema.pre('save', async function () {
        if (this.isNew || this.isModified()) {
          const docObj = this.toObject() as Record<string, unknown>;
          // Remove Mongoose internal fields
          delete docObj._id;
          delete docObj.__v;

          const { data } = await detector(docObj);
          // Apply tokenized values back to the document
          for (const [key, value] of Object.entries(data)) {
            if (key !== '_id' && key !== '__v' && this.get(key) !== value) {
              this.set(key, value);
            }
          }
        }
      });
    }

    // Post-save hook: Audit logging for creates and updates
    if (auditLogger) {
      const logger = auditLogger;

      schema.post('save', async function (doc) {
        try {
          const docObj = doc.toObject() as Record<string, unknown>;
          const entityId = String(docObj._id || docObj.hashId || 'unknown');
          const orgHashId = String(docObj.organizationHashId || docObj.orgHashId || 'unknown');
          const userHashId = String(docObj.userHashId || docObj.createdBy || 'system');

          await logger.logCreate({
            entityType: (doc.constructor as { modelName?: string }).modelName || 'document',
            entityId,
            organizationHashId: orgHashId,
            userHashId,
            newData: docObj,
          });
        } catch (err) {
          console.warn('[zorbit-sdk] Audit log failed for save:', err);
        }
      });

      schema.post('findOneAndUpdate', async function (doc) {
        if (!doc) return;
        try {
          const docObj = (doc as mongoose.Document).toObject() as Record<string, unknown>;
          const entityId = String(docObj._id || docObj.hashId || 'unknown');
          const orgHashId = String(docObj.organizationHashId || docObj.orgHashId || 'unknown');
          const userHashId = String(docObj.userHashId || docObj.updatedBy || 'system');
          const update = this.getUpdate() as Record<string, unknown> | null;

          await logger.logUpdate({
            entityType: 'document',
            entityId,
            organizationHashId: orgHashId,
            userHashId,
            oldData: docObj,
            newData: update ? { ...docObj, ...update } : docObj,
          });
        } catch (err) {
          console.warn('[zorbit-sdk] Audit log failed for update:', err);
        }
      });

      schema.post('findOneAndDelete', async function (doc) {
        if (!doc) return;
        try {
          const docObj = (doc as mongoose.Document).toObject() as Record<string, unknown>;
          const entityId = String(docObj._id || docObj.hashId || 'unknown');
          const orgHashId = String(docObj.organizationHashId || docObj.orgHashId || 'unknown');
          const userHashId = String(docObj.userHashId || docObj.deletedBy || 'system');

          await logger.logDelete({
            entityType: 'document',
            entityId,
            organizationHashId: orgHashId,
            userHashId,
            oldData: docObj,
          });
        } catch (err) {
          console.warn('[zorbit-sdk] Audit log failed for delete:', err);
        }
      });
    }
  });

  return connection;
}

/**
 * Create a configuration object for NestJS MongooseModule.forRootAsync().
 *
 * @example
 * ```typescript
 * import { MongooseModule } from '@nestjs/mongoose';
 * import { createMongooseModuleConfig } from '@zorbit-platform/sdk-node';
 *
 * @Module({
 *   imports: [
 *     MongooseModule.forRootAsync({
 *       useFactory: () => createMongooseModuleConfig({
 *         uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
 *         dbName: 'zorbit-datatable',
 *       }),
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
export function createMongooseModuleConfig(config: MongoAdapterConfig): {
  uri: string;
  dbName: string;
  directConnection: boolean;
  connectionFactory: (connection: Connection) => Connection;
} {
  const directConnection = config.directConnection !== false;
  const uri = ensureDirectConnection(config.uri, directConnection);

  return {
    uri,
    dbName: config.dbName,
    directConnection,
    connectionFactory: (connection: Connection) => {
      // Apply PII and audit plugins if configured
      if (config.piiDetector) {
        const piiScan = createPIIDetector(config.piiDetector);

        connection.plugin((schema) => {
          schema.pre('save', async function () {
            if (this.isNew || this.isModified()) {
              const docObj = this.toObject() as Record<string, unknown>;
              delete docObj._id;
              delete docObj.__v;
              const { data } = await piiScan(docObj);
              for (const [key, value] of Object.entries(data)) {
                if (key !== '_id' && key !== '__v' && this.get(key) !== value) {
                  this.set(key, value);
                }
              }
            }
          });
        });
      }

      if (config.auditLogger) {
        const logger = createAuditLogger(config.auditLogger);
        // Note: connect() is async, but connectionFactory is sync.
        // The logger will buffer events until connected.
        logger.connect().catch((err: Error) => {
          console.warn('[zorbit-sdk] Audit logger connection failed:', err);
        });

        connection.plugin((schema) => {
          schema.post('save', async function (doc) {
            try {
              const docObj = doc.toObject() as Record<string, unknown>;
              await logger.logCreate({
                entityType: (doc.constructor as { modelName?: string }).modelName || 'document',
                entityId: String(docObj._id || 'unknown'),
                organizationHashId: String(docObj.organizationHashId || 'unknown'),
                userHashId: String(docObj.userHashId || 'system'),
                newData: docObj,
              });
            } catch (_err) {
              // Audit failures should not break the application
            }
          });
        });
      }

      return connection;
    },
  };
}
