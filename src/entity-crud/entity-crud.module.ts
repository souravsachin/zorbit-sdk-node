/**
 * NestJS DynamicModule that loads every entity declaration from a
 * directory and mounts auto-generated CRUD controllers.
 *
 * Usage:
 *   imports: [
 *     ZorbitEntityCrudModule.register({
 *       entitiesDir: __dirname + '/entities',
 *       entityMap: { user: User },         // TypeORM entity class per slug
 *       moduleSlug: 'identity',            // prefix path -> /api/identity/...
 *       customHandlers: {
 *         user: { create: async ({ dto, actor }) => { ... } }
 *       }
 *     })
 *   ]
 */
import { DynamicModule, Logger, Module } from '@nestjs/common';
// Lazy @nestjs/typeorm import — only loaded when ZorbitEntityCrudModule.register()
// is actually invoked. Eager top-level `import` caused every consumer of
// `@zorbit-platform/sdk-node` to fail with `Cannot find module '@nestjs/typeorm'`
// even when the consumer never used entity-crud features.
// (Cycle 105 — VM 110 PM2 crash-loop fix, 2026-04-26.)
import { loadEntitiesFromDir } from './entity-loader';
import { parseEntityDeclaration } from './entity-schema';
import type { EntityDeclaration } from './entity-schema';
import { buildEntityController, CustomHandlers } from './controller-factory';
import { createEntityService } from './service-factory';
import type { AuditEventPublisher } from '../audit/event-publisher';

export interface ZorbitEntityCrudRegisterOptions {
  /** Absolute path to `<repo>/entities/` */
  entitiesDir?: string;
  /** Alternative: pass declarations directly instead of reading from disk */
  declarations?: EntityDeclaration[];
  /** Map entity slug -> TypeORM entity class registered with TypeOrmModule */
  entityMap: Record<string, any>;
  /** Mount prefix for every generated controller, e.g. `identity` */
  moduleSlug?: string;
  /** Shared audit publisher — generated services publish to Kafka through this */
  auditPublisher?: AuditEventPublisher;
  /** Override per-entity CRUD ops, keyed by entity slug */
  customHandlers?: Record<string, CustomHandlers>;
  /** If true, throw on load errors (default: false — log + continue) */
  failFast?: boolean;
}

@Module({})
export class ZorbitEntityCrudModule {
  static register(opts: ZorbitEntityCrudRegisterOptions): DynamicModule {
    const logger = new Logger('ZorbitEntityCrudModule');

    // Lazy-load @nestjs/typeorm — required only at register() time so that
    // consumers who never invoke this module don't pay the import cost.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getRepositoryToken, TypeOrmModule } = require('@nestjs/typeorm');

    const declarations: EntityDeclaration[] = [];
    if (opts.declarations && opts.declarations.length > 0) {
      for (const d of opts.declarations) {
        declarations.push(parseEntityDeclaration(d));
      }
    }
    if (opts.entitiesDir) {
      const loaded = loadEntitiesFromDir(opts.entitiesDir);
      for (const d of loaded.declarations) declarations.push(d);
      if (loaded.errors.length > 0) {
        for (const e of loaded.errors) {
          logger.error(`Entity declaration load error [${e.file}]: ${e.message}`);
        }
        if (opts.failFast) {
          throw new Error(
            `Failed to load entity declarations: ${loaded.errors
              .map((e) => e.file)
              .join(', ')}`,
          );
        }
      }
    }

    if (declarations.length === 0) {
      logger.warn(
        'No entity declarations loaded — ZorbitEntityCrudModule mounting no routes',
      );
    }

    const controllerClasses: any[] = [];
    const providers: any[] = [];
    const typeOrmEntities: any[] = [];

    for (const decl of declarations) {
      const entityClass = opts.entityMap?.[decl.entity];
      if (!entityClass) {
        logger.error(
          `No TypeORM entity class mapped for "${decl.entity}" — skipping`,
        );
        if (opts.failFast) {
          throw new Error(
            `Missing entityMap entry for "${decl.entity}"`,
          );
        }
        continue;
      }
      typeOrmEntities.push(entityClass);

      const serviceToken = Symbol(`ZorbitCrudService:${decl.entity}`);
      const repoToken = getRepositoryToken(entityClass);

      providers.push({
        provide: serviceToken,
        useFactory: (repo: any) =>
          createEntityService({
            declaration: decl,
            repository: repo,
            ...(opts.auditPublisher
              ? { auditPublisher: opts.auditPublisher }
              : {}),
          }),
        inject: [repoToken],
      });

      const ctrlInput: any = {
        declaration: decl,
        serviceConfig: {
          declaration: decl,
          repository: null as any,
          ...(opts.auditPublisher
            ? { auditPublisher: opts.auditPublisher }
            : {}),
        },
        serviceToken,
      };
      if (opts.customHandlers?.[decl.entity]) {
        ctrlInput.customHandlers = opts.customHandlers[decl.entity];
      }
      if (opts.moduleSlug) {
        ctrlInput.moduleSlug = opts.moduleSlug;
      }
      const { ControllerClass } = buildEntityController(ctrlInput);
      controllerClasses.push(ControllerClass);
      logger.log(
        `Mounted CRUD for "${decl.entity}" under /${opts.moduleSlug || ''}/api/v1/${decl.namespace}/.../${decl.resource || decl.entity + 's'}`,
      );
    }

    return {
      module: ZorbitEntityCrudModule,
      imports:
        typeOrmEntities.length > 0
          ? [TypeOrmModule.forFeature(typeOrmEntities)]
          : [],
      controllers: controllerClasses,
      providers,
      exports: providers,
    };
  }
}
