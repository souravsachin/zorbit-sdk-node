import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for public (no-auth) endpoints.
 * Used by ZorbitJwtGuard, ZorbitNamespaceGuard, and ZorbitPrivilegeGuard to skip checks.
 */
export const IS_PUBLIC_KEY = 'zorbit:isPublic';

/**
 * Marks an endpoint as public — no JWT, namespace, or privilege checks.
 * Use for health endpoints and other publicly accessible routes.
 *
 * @example
 * @Get('health')
 * @Public()
 * async healthCheck() { return { status: 'ok' }; }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Metadata key for required privilege codes.
 * Read by ZorbitPrivilegeGuard to enforce privilege-based access control.
 */
export const REQUIRED_PRIVILEGES_KEY = 'zorbit:requiredPrivileges';

/**
 * Declares the privilege codes required to access an endpoint.
 * The authenticated user must have ALL listed privileges in their JWT.
 *
 * Privilege codes follow dot notation: {module}.{resource}.{action}
 * Actions: read, create, update, delete, manage (all CRUD), execute (non-CRUD)
 *
 * @example
 * @Post('pages')
 * @RequirePrivileges('datatable.page.create')
 * async createPage() { }
 *
 * @example
 * @Delete('pages/:id')
 * @RequirePrivileges('datatable.page.delete', 'datatable.page.read')
 * async deletePage() { }
 */
export const RequirePrivileges = (...privileges: string[]) =>
  SetMetadata(REQUIRED_PRIVILEGES_KEY, privileges);
