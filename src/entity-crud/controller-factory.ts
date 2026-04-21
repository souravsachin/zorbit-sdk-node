/**
 * Controller factory.
 *
 * For each `EntityDeclaration` we build a concrete Nest Controller class
 * at import-time. Dynamic `@Controller()` path + method decorators are
 * applied imperatively because Nest's decorator stack is evaluated when
 * the class is defined — applying them via `Reflect.defineMetadata`
 * ourselves lets us use one class-template per declaration.
 *
 * The factory returns both the Controller class and a Nest provider
 * token that wraps the generated service. `ZorbitEntityCrudModule.register()`
 * assembles these into a DynamicModule.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { EntityDeclaration } from './entity-schema';
import { parseQuery } from './filter-parser';
import {
  ConcurrencyConflictError,
  EntityNotFoundError,
  ValidationFailedError,
  createEntityService,
} from './service-factory';
import type { CrudActor, EntityServiceConfig } from './service-factory';
import { rowsToCsv } from './export';
import { RequirePrivileges } from '../nestjs/decorators';
import { ZorbitJwtGuard } from '../nestjs/zorbit-jwt.guard';
import { ZorbitNamespaceGuard } from '../nestjs/zorbit-namespace.guard';
import { ZorbitPrivilegeGuard } from '../nestjs/zorbit-privilege.guard';

export interface CustomHandlers<T = Record<string, unknown>> {
  list?: (ctx: { scopeId: string; query: any; actor: CrudActor }) => Promise<any>;
  detail?: (ctx: {
    scopeId: string;
    hashId: string;
    actor: CrudActor;
  }) => Promise<T>;
  create?: (ctx: {
    scopeId: string;
    dto: Record<string, unknown>;
    actor: CrudActor;
  }) => Promise<T>;
  update?: (ctx: {
    scopeId: string;
    hashId: string;
    patch: Record<string, unknown>;
    actor: CrudActor;
    ifMatch?: string | number;
  }) => Promise<T>;
  delete?: (ctx: {
    scopeId: string;
    hashId: string;
    actor: CrudActor;
  }) => Promise<void>;
}

export interface ControllerFactoryInput<T extends Record<string, unknown>> {
  declaration: EntityDeclaration;
  serviceConfig: EntityServiceConfig<T>;
  customHandlers?: CustomHandlers<T>;
  /** Nest provider token under which the generated service is injected */
  serviceToken: string | symbol;
  /** Module slug under which the controller is mounted, e.g. 'identity' */
  moduleSlug?: string;
}

/**
 * Build a controller class + service provider for a single entity.
 */
export function buildEntityController<T extends Record<string, unknown>>(
  input: ControllerFactoryInput<T>,
): { ControllerClass: any; serviceToken: string | symbol } {
  const { declaration, customHandlers, serviceToken, moduleSlug } = input;

  const resourceSlug =
    declaration.resource ||
    (declaration.entity.endsWith('s')
      ? declaration.entity
      : `${declaration.entity}s`);

  const basePath = buildControllerPath(
    declaration,
    resourceSlug,
    moduleSlug,
  );

  const scopeParamName = scopeParamFor(declaration.namespace);

  class DynamicEntityController {
    constructor(
      @Inject(serviceToken as any)
      private readonly service: ReturnType<typeof createEntityService<T>>,
    ) {}

    async listHandler(
      scopeId: string,
      queryRaw: any,
      req: Request,
    ): Promise<any> {
      const query = parseQuery(queryRaw);
      const actor = actorFromReq(req);
      try {
        if (customHandlers?.list) {
          return await customHandlers.list({ scopeId, query, actor });
        }
        return await this.service.list(scopeId, query, actor);
      } catch (e) {
        throw toHttp(e);
      }
    }

    async detailHandler(
      scopeId: string,
      hashId: string,
      req: Request,
    ): Promise<T> {
      const actor = actorFromReq(req);
      try {
        if (customHandlers?.detail) {
          return await customHandlers.detail({ scopeId, hashId, actor });
        }
        return await this.service.findOne(scopeId, hashId, actor);
      } catch (e) {
        throw toHttp(e);
      }
    }

    async createHandler(
      scopeId: string,
      dto: Record<string, unknown>,
      req: Request,
    ): Promise<T> {
      const actor = actorFromReq(req);
      try {
        if (customHandlers?.create) {
          return await customHandlers.create({ scopeId, dto, actor });
        }
        return await this.service.create(scopeId, dto, actor);
      } catch (e) {
        throw toHttp(e);
      }
    }

    async updateHandler(
      scopeId: string,
      hashId: string,
      patch: Record<string, unknown>,
      req: Request,
      ifMatch?: string,
    ): Promise<T> {
      const actor = actorFromReq(req);
      try {
        if (customHandlers?.update) {
          const ctx: any = { scopeId, hashId, patch, actor };
          if (ifMatch !== undefined) ctx.ifMatch = ifMatch;
          return await customHandlers.update(ctx);
        }
        const concurrency: any = {};
        if (ifMatch !== undefined) concurrency.ifMatch = ifMatch;
        return await this.service.update(scopeId, hashId, patch, actor, concurrency);
      } catch (e) {
        throw toHttp(e);
      }
    }

    async deleteHandler(
      scopeId: string,
      hashId: string,
      req: Request,
    ): Promise<void> {
      const actor = actorFromReq(req);
      try {
        if (customHandlers?.delete) {
          return await customHandlers.delete({ scopeId, hashId, actor });
        }
        return await this.service.remove(scopeId, hashId, actor);
      } catch (e) {
        throw toHttp(e);
      }
    }

    async exportHandler(
      scopeId: string,
      queryRaw: any,
      req: Request,
      res: Response,
    ): Promise<void> {
      const query = parseQuery(queryRaw);
      const actor = actorFromReq(req);
      try {
        const rows = await this.service.exportCsv(scopeId, query, actor);
        const fields = declaration.fields.map((f) => f.key);
        const csv = rowsToCsv(rows as Array<Record<string, unknown>>, {
          fields,
        });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${declaration.entity}.csv"`,
        );
        res.status(200).send(csv);
      } catch (e) {
        throw toHttp(e);
      }
    }
  }

  // --- apply decorators imperatively ---

  Controller(basePath)(DynamicEntityController);
  UseGuards(ZorbitJwtGuard, ZorbitNamespaceGuard, ZorbitPrivilegeGuard)(
    DynamicEntityController,
  );

  // list
  decorateMethod(DynamicEntityController, 'listHandler', [
    Get(),
    declaration.privileges?.read
      ? RequirePrivileges(declaration.privileges.read)
      : undefined,
  ]);
  applyParamDecorators(DynamicEntityController, 'listHandler', [
    Param(scopeParamName)(DynamicEntityController.prototype, 'listHandler', 0),
    Query()(DynamicEntityController.prototype, 'listHandler', 1),
    Req()(DynamicEntityController.prototype, 'listHandler', 2),
  ]);

  // create
  decorateMethod(DynamicEntityController, 'createHandler', [
    Post(),
    HttpCode(HttpStatus.CREATED),
    declaration.privileges?.create
      ? RequirePrivileges(declaration.privileges.create)
      : undefined,
  ]);
  applyParamDecorators(DynamicEntityController, 'createHandler', [
    Param(scopeParamName)(
      DynamicEntityController.prototype,
      'createHandler',
      0,
    ),
    Body()(DynamicEntityController.prototype, 'createHandler', 1),
    Req()(DynamicEntityController.prototype, 'createHandler', 2),
  ]);

  // export — BEFORE detail so /export is not swallowed by /:hashId
  decorateMethod(DynamicEntityController, 'exportHandler', [
    Get('export'),
    declaration.privileges?.export
      ? RequirePrivileges(declaration.privileges.export)
      : undefined,
  ]);
  applyParamDecorators(DynamicEntityController, 'exportHandler', [
    Param(scopeParamName)(
      DynamicEntityController.prototype,
      'exportHandler',
      0,
    ),
    Query()(DynamicEntityController.prototype, 'exportHandler', 1),
    Req()(DynamicEntityController.prototype, 'exportHandler', 2),
    Res()(DynamicEntityController.prototype, 'exportHandler', 3),
  ]);

  // detail
  decorateMethod(DynamicEntityController, 'detailHandler', [
    Get(':hashId'),
    declaration.privileges?.read
      ? RequirePrivileges(declaration.privileges.read)
      : undefined,
  ]);
  applyParamDecorators(DynamicEntityController, 'detailHandler', [
    Param(scopeParamName)(
      DynamicEntityController.prototype,
      'detailHandler',
      0,
    ),
    Param('hashId')(DynamicEntityController.prototype, 'detailHandler', 1),
    Req()(DynamicEntityController.prototype, 'detailHandler', 2),
  ]);

  // update
  decorateMethod(DynamicEntityController, 'updateHandler', [
    Put(':hashId'),
    declaration.privileges?.update
      ? RequirePrivileges(declaration.privileges.update)
      : undefined,
  ]);
  applyParamDecorators(DynamicEntityController, 'updateHandler', [
    Param(scopeParamName)(
      DynamicEntityController.prototype,
      'updateHandler',
      0,
    ),
    Param('hashId')(DynamicEntityController.prototype, 'updateHandler', 1),
    Body()(DynamicEntityController.prototype, 'updateHandler', 2),
    Req()(DynamicEntityController.prototype, 'updateHandler', 3),
    Headers('if-match')(
      DynamicEntityController.prototype,
      'updateHandler',
      4,
    ),
  ]);

  // delete
  decorateMethod(DynamicEntityController, 'deleteHandler', [
    Delete(':hashId'),
    HttpCode(HttpStatus.NO_CONTENT),
    declaration.privileges?.delete
      ? RequirePrivileges(declaration.privileges.delete)
      : undefined,
  ]);
  applyParamDecorators(DynamicEntityController, 'deleteHandler', [
    Param(scopeParamName)(
      DynamicEntityController.prototype,
      'deleteHandler',
      0,
    ),
    Param('hashId')(DynamicEntityController.prototype, 'deleteHandler', 1),
    Req()(DynamicEntityController.prototype, 'deleteHandler', 2),
  ]);

  // Clone under a unique symbol name for Nest's DI (avoid duplicate class
  // name collisions when multiple entities are registered).
  Object.defineProperty(DynamicEntityController, 'name', {
    value: `ZorbitCrudController__${declaration.entity}`,
  });

  return {
    ControllerClass: DynamicEntityController,
    serviceToken,
  };
}

// ---- helpers ----

function buildControllerPath(
  decl: EntityDeclaration,
  resourceSlug: string,
  moduleSlug: string | undefined,
): string {
  const mod = moduleSlug ? `api/${moduleSlug}/` : '';
  const param = scopeParamFor(decl.namespace);
  return `${mod}api/v1/${decl.namespace}/:${param}/${resourceSlug}`;
}

function scopeParamFor(ns: string): string {
  switch (ns) {
    case 'O':
      return 'orgId';
    case 'D':
      return 'deptId';
    case 'U':
      return 'userId';
    case 'G':
    default:
      return 'scope';
  }
}

function decorateMethod(
  cls: any,
  method: string,
  decorators: Array<MethodDecorator | undefined>,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(cls.prototype, method);
  if (!descriptor) return;
  for (const d of decorators) {
    if (!d) continue;
    d(cls.prototype, method, descriptor);
  }
  Object.defineProperty(cls.prototype, method, descriptor);
}

function applyParamDecorators(
  _cls: any,
  _method: string,
  _calls: Array<void>,
): void {
  // The decorator calls themselves are invoked inline — we just accept
  // the array to keep call sites readable.
  // no-op
}

function actorFromReq(req: Request): CrudActor {
  const user = (req as any).user || {};
  const actor: CrudActor = {
    userHashId: user.sub || user.hashId || 'U-UNKNOWN',
    organizationHashId: user.org || 'O-UNKNOWN',
  };
  if ('role' in user) actor.role = user.role;
  if (Array.isArray(user.privileges)) actor.privileges = user.privileges;
  return actor;
}

function toHttp(e: unknown): HttpException {
  if (e instanceof ConcurrencyConflictError) {
    return new HttpException(
      { message: e.message, currentVersion: e.currentVersion },
      HttpStatus.CONFLICT,
    );
  }
  if (e instanceof EntityNotFoundError) {
    return new HttpException(e.message, HttpStatus.NOT_FOUND);
  }
  if (e instanceof ValidationFailedError) {
    return new HttpException(e.message, HttpStatus.BAD_REQUEST);
  }
  if (e instanceof HttpException) return e;
  return new HttpException(
    (e as Error)?.message || 'internal error',
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}
