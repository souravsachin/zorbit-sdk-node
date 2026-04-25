import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './decorators';
import { ZorbitJwtPayload } from './jwt.strategy';
import { hasPrivilege } from '../auth/wildcard-checker';

/**
 * Privilege code that grants cross-organization access.
 * Assigned to the superadmin role via the authorization service seed.
 * This is the ONLY mechanism for cross-org bypass — no role name checking.
 */
const CROSS_ORG_PRIVILEGE = 'platform.namespace.bypass';

/**
 * Namespace isolation guard for all Zorbit services.
 *
 * Enforces that org-scoped requests (routes with :orgId) match the
 * authenticated user's organization claim in the JWT.
 *
 * Cross-org access is granted ONLY to users who hold the
 * `platform.namespace.bypass` privilege — never by role name.
 *
 * For user-scoped routes (:userId), self-access is always allowed.
 * Operating on another user requires `platform.namespace.bypass`.
 *
 * Global routes (no :orgId or :userId param) always pass.
 */
@Injectable()
export class ZorbitNamespaceGuard implements CanActivate {
  private readonly logger = new Logger(ZorbitNamespaceGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // @Public() endpoints skip namespace checks
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: ZorbitJwtPayload | undefined = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required for namespace validation');
    }

    const params = request.params || {};

    // Organization namespace check
    if (params.orgId && params.orgId !== user.org) {
      if (this.hasCrossOrgPrivilege(user)) {
        this.logger.log(
          `Cross-org access granted for user ${user.sub} ` +
          `(own org: ${user.org}, target org: ${params.orgId})`,
        );
        return true;
      }
      throw new ForbiddenException(
        `Access denied: namespace mismatch for organization ${params.orgId}`,
      );
    }

    // User namespace check
    if (params.userId && params.userId !== user.sub) {
      if (this.hasCrossOrgPrivilege(user)) {
        this.logger.log(
          `Cross-user access granted for user ${user.sub} ` +
          `operating on user ${params.userId} in org ${user.org}`,
        );
        return true;
      }
      throw new ForbiddenException(
        `Access denied: namespace mismatch for user ${params.userId}`,
      );
    }

    return true;
  }

  /**
   * Check if the user holds the cross-org bypass privilege.
   * This is privilege-based — no role name checking.
   */
  private hasCrossOrgPrivilege(user: ZorbitJwtPayload): boolean {
    // Slim-JWT aware: accept the explicit code OR a wildcard claim that covers it.
    const wildcards = (user as ZorbitJwtPayload & { wildcards?: string[] }).wildcards || [];
    if (Array.isArray(user.privileges) && user.privileges.includes(CROSS_ORG_PRIVILEGE)) {
      return true;
    }
    return hasPrivilege({ privileges: user.privileges, wildcards }, CROSS_ORG_PRIVILEGE);
  }
}
