import {
  ZorbitError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  ConflictError,
} from '../src/errors/zorbit-error';

describe('ZorbitError', () => {
  it('should create a base error with defaults', () => {
    const error = new ZorbitError('Something went wrong');
    expect(error.message).toBe('Something went wrong');
    expect(error.statusCode).toBe(500);
    expect(error.errorCode).toBe('INTERNAL_ERROR');
    expect(error.name).toBe('ZorbitError');
  });

  it('should create a base error with custom values', () => {
    const error = new ZorbitError('Custom error', 422, 'CUSTOM_CODE', { field: 'name' });
    expect(error.statusCode).toBe(422);
    expect(error.errorCode).toBe('CUSTOM_CODE');
    expect(error.details).toEqual({ field: 'name' });
  });

  it('should serialize to API error response format', () => {
    const error = new ZorbitError('Test error', 500, 'TEST_ERROR');
    const response = error.toResponse();

    expect(response).toEqual({
      error: {
        code: 'TEST_ERROR',
        message: 'Test error',
        statusCode: 500,
      },
    });
  });

  it('should include details in response when present', () => {
    const error = new ZorbitError('Test', 400, 'TEST', { fields: ['a', 'b'] });
    const response = error.toResponse();

    expect(response.error.details).toEqual({ fields: ['a', 'b'] });
  });

  it('should be instanceof Error', () => {
    const error = new ZorbitError('test');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ZorbitError);
  });
});

describe('NotFoundError', () => {
  it('should have correct defaults', () => {
    const error = new NotFoundError();
    expect(error.statusCode).toBe(404);
    expect(error.errorCode).toBe('NOT_FOUND');
    expect(error.message).toBe('Resource not found');
    expect(error).toBeInstanceOf(ZorbitError);
  });

  it('should accept custom message', () => {
    const error = new NotFoundError('User not found');
    expect(error.message).toBe('User not found');
  });
});

describe('UnauthorizedError', () => {
  it('should have correct defaults', () => {
    const error = new UnauthorizedError();
    expect(error.statusCode).toBe(401);
    expect(error.errorCode).toBe('UNAUTHORIZED');
  });
});

describe('ForbiddenError', () => {
  it('should have correct defaults', () => {
    const error = new ForbiddenError();
    expect(error.statusCode).toBe(403);
    expect(error.errorCode).toBe('FORBIDDEN');
  });
});

describe('ValidationError', () => {
  it('should have correct defaults', () => {
    const error = new ValidationError();
    expect(error.statusCode).toBe(400);
    expect(error.errorCode).toBe('VALIDATION_ERROR');
  });

  it('should support details for validation fields', () => {
    const error = new ValidationError('Invalid input', {
      fields: {
        email: 'Must be a valid email',
        name: 'Required',
      },
    });
    expect(error.details).toEqual({
      fields: {
        email: 'Must be a valid email',
        name: 'Required',
      },
    });
  });
});

describe('ConflictError', () => {
  it('should have correct defaults', () => {
    const error = new ConflictError();
    expect(error.statusCode).toBe(409);
    expect(error.errorCode).toBe('CONFLICT');
  });
});
