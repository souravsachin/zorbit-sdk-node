import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, REQUIRED_PRIVILEGES_KEY } from './decorators';
import { ZorbitJwtPayload } from './jwt.strategy';

/**
 * Privilege-based access control guard for all Zorbit services.
 *
 * Reads @RequirePrivileges() metadata from the handler (method-level)
 * and class (controller-level). Checks that the authenticated user's
 * JWT contains ALL required privilege codes.
 *
 * If no @RequirePrivileges() is set on the handler, the guard passes
 * (authentication-only endpoint — JWT is sufficient).
 *
 * Privilege codes follow dot notation: {module}.{resource}.{action}
 * Example: 'datatable.page.create', 'platform.seed.execute'
 *
 * Superadmin bypass: a user whose JWT carries `platform.superadmin.bypass`
 * bypasses all privilege checks. This is the replacement for the legacy
 * role-name short-circuit that the SDK migration removed.
 */
export const SUPERADMIN_BYPASS_PRIVILEGE = 'platform.superadmin.bypass';

@Injectable()
export class ZorbitPrivilegeGuard implements CanActivate {
  private readonly logger = new Logger(ZorbitPrivilegeGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // @Public() endpoints skip privilege checks
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // Collect required privileges from both handler and class level.
    // Handler-level @RequirePrivileges() takes precedence; class-level is additive.
    const handlerPrivileges =
      this.reflector.get<string[]>(REQUIRED_PRIVILEGES_KEY, context.getHandler()) || [];
    const classPrivileges =
      this.reflector.get<string[]>(REQUIRED_PRIVILEGES_KEY, context.getClass()) || [];

    const requiredPrivileges = [...new Set([...handlerPrivileges, ...classPrivileges])];

    // No privileges required on this endpoint — pass (auth-only)
    if (requiredPrivileges.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: ZorbitJwtPayload | undefined = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required for privilege validation');
    }

    const userPrivileges = new Set(user.privileges || []);

    // Superadmin bypass — user with 'platform.superadmin.bypass' privilege
    // passes all @RequirePrivileges() checks. Used for platform operators
    // who need to cross any module's privilege fence without an exhaustive
    // per-privilege grant.
    if (userPrivileges.has(SUPERADMIN_BYPASS_PRIVILEGE)) {
      return true;
    }

    const missingPrivileges = requiredPrivileges.filter((p) => !userPrivileges.has(p));

    if (missingPrivileges.length > 0) {
      this.logger.warn(
        `User ${user.sub} denied access: missing privileges [${missingPrivileges.join(', ')}]`,
      );
      throw new ForbiddenException(
        `Insufficient privileges. Required: [${missingPrivileges.join(', ')}]`,
      );
    }

    return true;
  }
}
