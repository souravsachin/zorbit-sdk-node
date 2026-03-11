import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { UnauthorizedError } from '../errors/zorbit-error';

export interface JwtAuthOptions {
  /** Secret or public key used to verify the JWT */
  secret: string;
  /** Expected issuer claim */
  issuer?: string;
  /** Expected audience claim */
  audience?: string;
  /** Algorithms to allow (default: ['HS256']) */
  algorithms?: jwt.Algorithm[];
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: jwt.JwtPayload;
    }
  }
}

/**
 * Express-compatible middleware that validates JWT Bearer tokens.
 *
 * Extracts the token from the Authorization header, verifies it,
 * and attaches the decoded payload to req.user.
 */
export function jwtAuthMiddleware(options: JwtAuthOptions) {
  const { secret, issuer, audience, algorithms = ['HS256'] } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      const error = new UnauthorizedError('Missing Authorization header');
      res.status(error.statusCode).json(error.toResponse());
      return;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      const error = new UnauthorizedError('Invalid Authorization header format. Expected: Bearer <token>');
      res.status(error.statusCode).json(error.toResponse());
      return;
    }

    const token = parts[1];

    try {
      const verifyOptions: jwt.VerifyOptions = { algorithms };
      if (issuer) verifyOptions.issuer = issuer;
      if (audience) verifyOptions.audience = audience;

      const decoded = jwt.verify(token, secret, verifyOptions);
      req.user = decoded as jwt.JwtPayload;
      next();
    } catch (err) {
      const message = err instanceof jwt.TokenExpiredError
        ? 'Token has expired'
        : err instanceof jwt.JsonWebTokenError
          ? 'Invalid token'
          : 'Token verification failed';

      const error = new UnauthorizedError(message);
      res.status(error.statusCode).json(error.toResponse());
    }
  };
}
