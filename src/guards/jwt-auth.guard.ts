import jwt from 'jsonwebtoken';
import { UnauthorizedError, ForbiddenError } from '../errors/zorbit-error';

/**
 * Configuration for the NestJS-compatible JWT auth guard.
 */
export interface JwtGuardOptions {
  /** Secret or public key used to verify the JWT */
  secret: string;
  /** Expected issuer claim */
  issuer?: string;
  /** Expected audience claim */
  audience?: string;
  /** Algorithms to allow (default: ['HS256']) */
  algorithms?: jwt.Algorithm[];
  /** Required roles (user must have at least one) */
  roles?: string[];
  /** Required privileges (user must have all) */
  privileges?: string[];
}

/**
 * NestJS-compatible guard interface.
 *
 * This guard works with NestJS execution context or as a plain
 * Express middleware. It validates JWT, checks roles/privileges,
 * and attaches the decoded payload to the request.
 *
 * @example
 * ```typescript
 * // As NestJS guard (manual usage in a controller guard method)
 * import { JwtAuthGuard } from '@zorbit-platform/sdk-node';
 *
 * const guard = new JwtAuthGuard({ secret: process.env.JWT_SECRET! });
 *
 * // In a NestJS CanActivate implementation:
 * canActivate(context: ExecutionContext): boolean {
 *   const req = context.switchToHttp().getRequest();
 *   return guard.validateRequest(req);
 * }
 *
 * // As Express middleware:
 * app.use(JwtAuthGuard.asMiddleware({ secret: process.env.JWT_SECRET! }));
 *
 * // With role/privilege checks:
 * app.use(JwtAuthGuard.asMiddleware({
 *   secret: process.env.JWT_SECRET!,
 *   roles: ['admin', 'superadmin'],
 *   privileges: ['CUSTOMER_VIEW'],
 * }));
 * ```
 */
export class JwtAuthGuard {
  private options: JwtGuardOptions;

  constructor(options: JwtGuardOptions) {
    this.options = options;
  }

  /**
   * Validate a request and attach decoded JWT to req.user.
   * Returns true if valid, throws UnauthorizedError/ForbiddenError otherwise.
   */
  validateRequest(req: { headers: Record<string, string | string[] | undefined>; user?: jwt.JwtPayload }): boolean {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;

    if (!headerValue) {
      throw new UnauthorizedError('Missing Authorization header');
    }

    const parts = headerValue.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      throw new UnauthorizedError('Invalid Authorization header format');
    }

    const token = parts[1];
    const { secret, issuer, audience, algorithms = ['HS256'] } = this.options;

    try {
      const verifyOptions: jwt.VerifyOptions = { algorithms };
      if (issuer) verifyOptions.issuer = issuer;
      if (audience) verifyOptions.audience = audience;

      const decoded = jwt.verify(token, secret, verifyOptions) as jwt.JwtPayload;
      req.user = decoded;

      // Check roles if required
      if (this.options.roles && this.options.roles.length > 0) {
        const userRoles: string[] = (decoded.roles as string[]) || [];
        const hasRole = this.options.roles.some((r) => userRoles.includes(r));
        if (!hasRole) {
          throw new ForbiddenError('Insufficient role');
        }
      }

      // Check privileges if required
      if (this.options.privileges && this.options.privileges.length > 0) {
        const userPrivileges: string[] = (decoded.privileges as string[]) || [];
        const hasAll = this.options.privileges.every((p) => userPrivileges.includes(p));
        if (!hasAll) {
          throw new ForbiddenError('Insufficient privileges');
        }
      }

      return true;
    } catch (err) {
      if (err instanceof UnauthorizedError || err instanceof ForbiddenError) throw err;

      const message = err instanceof jwt.TokenExpiredError
        ? 'Token has expired'
        : err instanceof jwt.JsonWebTokenError
          ? 'Invalid token'
          : 'Token verification failed';

      throw new UnauthorizedError(message);
    }
  }

  /**
   * Create an Express-compatible middleware from guard options.
   */
  static asMiddleware(options: JwtGuardOptions) {
    const guard = new JwtAuthGuard(options);

    return (req: { headers: Record<string, string | string[] | undefined>; user?: jwt.JwtPayload }, res: { status: (code: number) => { json: (body: unknown) => void } }, next: () => void): void => {
      try {
        guard.validateRequest(req);
        next();
      } catch (err) {
        if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
          res.status(err.statusCode).json(err.toResponse());
        } else {
          res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication failed', statusCode: 401 } });
        }
      }
    };
  }
}
