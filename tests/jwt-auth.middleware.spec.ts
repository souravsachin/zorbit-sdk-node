import jwt from 'jsonwebtoken';
import { jwtAuthMiddleware } from '../src/middleware/jwt-auth.middleware';

const SECRET = 'test-secret-key';
const mockNext = jest.fn();

function createMockReq(authHeader?: string): any {
  return {
    headers: {
      authorization: authHeader,
    },
  };
}

function createMockRes(): any {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('jwtAuthMiddleware', () => {
  const middleware = jwtAuthMiddleware({ secret: SECRET });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 when Authorization header is missing', () => {
    const req = createMockReq();
    const res = createMockRes();

    middleware(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'UNAUTHORIZED',
          message: 'Missing Authorization header',
        }),
      }),
    );
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 when Authorization header format is invalid', () => {
    const req = createMockReq('Basic abc123');
    const res = createMockRes();

    middleware(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 when token is invalid', () => {
    const req = createMockReq('Bearer invalid.token.here');
    const res = createMockRes();

    middleware(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'UNAUTHORIZED',
          message: 'Invalid token',
        }),
      }),
    );
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 when token is expired', () => {
    const token = jwt.sign({ sub: 'U-81F3' }, SECRET, { expiresIn: -10 });
    const req = createMockReq(`Bearer ${token}`);
    const res = createMockRes();

    middleware(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'Token has expired',
        }),
      }),
    );
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should call next and attach user when token is valid', () => {
    const payload = { sub: 'U-81F3', org: 'O-92AF' };
    const token = jwt.sign(payload, SECRET, { expiresIn: '1h' });
    const req = createMockReq(`Bearer ${token}`);
    const res = createMockRes();

    middleware(req, res, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.sub).toBe('U-81F3');
    expect(req.user.org).toBe('O-92AF');
  });

  it('should validate issuer when configured', () => {
    const issuerMiddleware = jwtAuthMiddleware({ secret: SECRET, issuer: 'accounts.platform.com' });

    // Token without correct issuer
    const wrongToken = jwt.sign({ sub: 'U-81F3' }, SECRET, { issuer: 'wrong-issuer' });
    const req1 = createMockReq(`Bearer ${wrongToken}`);
    const res1 = createMockRes();

    issuerMiddleware(req1, res1, mockNext);
    expect(res1.status).toHaveBeenCalledWith(401);

    // Token with correct issuer
    const correctToken = jwt.sign({ sub: 'U-81F3' }, SECRET, { issuer: 'accounts.platform.com' });
    const req2 = createMockReq(`Bearer ${correctToken}`);
    const res2 = createMockRes();

    issuerMiddleware(req2, res2, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(req2.user.sub).toBe('U-81F3');
  });
});
