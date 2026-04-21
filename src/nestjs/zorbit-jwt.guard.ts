import { Injectable, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import type { ZorbitJwtPayload } from './jwt.strategy';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from './decorators';

/**
 * JWT authentication guard for all Zorbit services.
 *
 * Validates the Bearer token via Passport JWT strategy.
 * Respects the @Public() decorator — endpoints marked public skip authentication.
 *
 * Usage:
 *   @UseGuards(ZorbitJwtGuard, ZorbitNamespaceGuard, ZorbitPrivilegeGuard)
 *   @Controller('api/v1/O/:orgId/mymodule')
 *   export class MyController { }
 *
 * For bootstrap seeding without auth:
 *   Set ALLOW_UNAUTHENTICATED_SEED=true in environment.
 */
@Injectable()
export class ZorbitJwtGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(ZorbitJwtGuard.name);

  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // @Public() endpoints skip authentication entirely
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // Bootstrap escape hatch: allow unauthenticated seed during initial setup
    const request = context.switchToHttp().getRequest();
    if (
      process.env.ALLOW_UNAUTHENTICATED_SEED === 'true' &&
      request.path?.includes('/seed')
    ) {
      this.logger.warn(
        'ALLOW_UNAUTHENTICATED_SEED is enabled — skipping JWT check for seed endpoint. ' +
        'Disable this in production!',
      );
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest<TUser = ZorbitJwtPayload>(
    err: unknown,
    user: TUser | false,
    info: unknown,
  ): TUser {
    if (err || !user) {
      const message = info instanceof Error ? info.message : 'Authentication required';
      throw (err as Error) || new UnauthorizedException(message);
    }
    return user;
  }
}
