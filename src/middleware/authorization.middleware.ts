import axios from 'axios';
import { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '../errors/zorbit-error';

export interface AuthorizationOptions {
  /** URL of the Zorbit authorization service */
  authorizationServiceUrl: string;
  /** Timeout in milliseconds for the authorization request (default: 5000) */
  timeout?: number;
}

/**
 * Express-compatible middleware that checks required privileges
 * against the Zorbit authorization service.
 *
 * @param privilegeCodes - Array of privilege codes required for the endpoint
 * @param options - Authorization service configuration
 */
export function authorizationMiddleware(
  privilegeCodes: string[],
  options: AuthorizationOptions,
) {
  const { authorizationServiceUrl, timeout = 5000 } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      const error = new UnauthorizedError('Authentication required before authorization check');
      res.status(error.statusCode).json(error.toResponse());
      return;
    }

    try {
      const response = await axios.post(
        `${authorizationServiceUrl}/api/v1/G/authorize`,
        {
          subject: req.user.sub,
          privileges: privilegeCodes,
          namespace: {
            type: req.params.namespaceType,
            id: req.params.namespaceId,
          },
        },
        {
          headers: {
            Authorization: req.headers.authorization || '',
            'Content-Type': 'application/json',
          },
          timeout,
        },
      );

      if (response.data?.authorized === true) {
        next();
      } else {
        const error = new ForbiddenError('Insufficient privileges');
        res.status(error.statusCode).json(error.toResponse());
      }
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 403) {
        const error = new ForbiddenError('Insufficient privileges');
        res.status(error.statusCode).json(error.toResponse());
      } else {
        const error = new ForbiddenError('Authorization service unavailable');
        res.status(error.statusCode).json(error.toResponse());
      }
    }
  };
}
