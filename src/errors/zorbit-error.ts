/**
 * API error response format returned by all Zorbit services.
 */
export interface ZorbitErrorResponse {
  error: {
    code: string;
    message: string;
    statusCode: number;
    details?: unknown;
  };
}

/**
 * Base error class for all Zorbit platform errors.
 *
 * Provides HTTP status code, error code, and serialization
 * to the standard API error response format.
 */
export class ZorbitError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number = 500,
    errorCode: string = 'INTERNAL_ERROR',
    details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Serialize to the standard Zorbit API error response format.
   */
  toResponse(): ZorbitErrorResponse {
    return {
      error: {
        code: this.errorCode,
        message: this.message,
        statusCode: this.statusCode,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

export class NotFoundError extends ZorbitError {
  constructor(message: string = 'Resource not found', details?: unknown) {
    super(message, 404, 'NOT_FOUND', details);
  }
}

export class UnauthorizedError extends ZorbitError {
  constructor(message: string = 'Unauthorized', details?: unknown) {
    super(message, 401, 'UNAUTHORIZED', details);
  }
}

export class ForbiddenError extends ZorbitError {
  constructor(message: string = 'Forbidden', details?: unknown) {
    super(message, 403, 'FORBIDDEN', details);
  }
}

export class ValidationError extends ZorbitError {
  constructor(message: string = 'Validation failed', details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class ConflictError extends ZorbitError {
  constructor(message: string = 'Resource conflict', details?: unknown) {
    super(message, 409, 'CONFLICT', details);
  }
}
