import { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '../errors/zorbit-error';
import { NamespaceType, validateNamespaceAccess } from '../utils/namespace';

export interface NamespaceMiddlewareOptions {
  /** Route parameter name for organization ID (default: 'orgId') */
  orgIdParam?: string;
  /** Route parameter name for department ID (default: 'deptId') */
  deptIdParam?: string;
  /** Route parameter name for user ID (default: 'userId') */
  userIdParam?: string;
}

/**
 * Express-compatible middleware that validates namespace parameters
 * against JWT claims.
 *
 * Ensures users can only access resources within their authorized
 * namespace scope.
 */
export function namespaceMiddleware(options: NamespaceMiddlewareOptions = {}) {
  const {
    orgIdParam = 'orgId',
    deptIdParam = 'deptId',
    userIdParam = 'userId',
  } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      const error = new UnauthorizedError('Authentication required before namespace validation');
      res.status(error.statusCode).json(error.toResponse());
      return;
    }

    const claims = req.user;

    // Check organization namespace
    const orgId = req.params[orgIdParam];
    if (orgId) {
      const hasAccess = validateNamespaceAccess(claims, {
        type: NamespaceType.Organization,
        id: orgId,
      });
      if (!hasAccess) {
        const error = new ForbiddenError(`Access denied to organization namespace: ${orgId}`);
        res.status(error.statusCode).json(error.toResponse());
        return;
      }
    }

    // Check department namespace
    const deptId = req.params[deptIdParam];
    if (deptId) {
      const hasAccess = validateNamespaceAccess(claims, {
        type: NamespaceType.Department,
        id: deptId,
      });
      if (!hasAccess) {
        const error = new ForbiddenError(`Access denied to department namespace: ${deptId}`);
        res.status(error.statusCode).json(error.toResponse());
        return;
      }
    }

    // Check user namespace
    const userId = req.params[userIdParam];
    if (userId) {
      const hasAccess = validateNamespaceAccess(claims, {
        type: NamespaceType.User,
        id: userId,
      });
      if (!hasAccess) {
        const error = new ForbiddenError(`Access denied to user namespace: ${userId}`);
        res.status(error.statusCode).json(error.toResponse());
        return;
      }
    }

    next();
  };
}
