import { createQuotaManager, clearQuotaStore } from '../src/middleware/quota-manager';
import { Request, Response } from 'express';

// Helper to create mock req/res/next
function createMocks(overrides?: Partial<Request>) {
  const req = {
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
    user: { org: 'O-TEST' },
    ...overrides,
  } as unknown as Request;

  const headers: Record<string, string> = {};
  const res = {
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    _headers: headers,
  } as unknown as Response & { _headers: Record<string, string> };

  const next = jest.fn();

  return { req, res, next, headers };
}

describe('Quota Manager', () => {
  beforeEach(() => {
    clearQuotaStore();
  });

  describe('basic rate limiting', () => {
    it('should allow requests under the limit', () => {
      const middleware = createQuotaManager({
        windows: { perSecond: 5 },
      });

      const { req, res, next } = createMocks();
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should block requests over the per-second limit', () => {
      const middleware = createQuotaManager({
        windows: { perSecond: 2 },
      });

      const { req, res, next } = createMocks();

      // First two requests should pass
      middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(2);

      // Third request should be blocked
      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'QUOTA_EXCEEDED',
            statusCode: 429,
          }),
        }),
      );
    });
  });

  describe('rate limit headers', () => {
    it('should set X-RateLimit headers on allowed requests', () => {
      const middleware = createQuotaManager({
        windows: { perMinute: 60 },
      });

      const { req, res, next } = createMocks();
      middleware(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '60');
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', expect.any(String));
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(String));
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Window', 'per-minute');
    });

    it('should set Retry-After header on blocked requests', () => {
      const middleware = createQuotaManager({
        windows: { perSecond: 1 },
      });

      const { req, res, next } = createMocks();
      middleware(req, res, next); // first passes
      middleware(req, res, next); // second blocked

      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    });
  });

  describe('key extraction', () => {
    it('should use orgHashId from JWT by default', () => {
      const middleware = createQuotaManager({
        windows: { perSecond: 1 },
      });

      // Different org = different rate limit bucket
      const { req: req1, res: res1, next: next1 } = createMocks({
        user: { org: 'O-AAAA' },
      } as Partial<Request>);
      const { req: req2, res: res2, next: next2 } = createMocks({
        user: { org: 'O-BBBB' },
      } as Partial<Request>);

      middleware(req1, res1, next1);
      middleware(req2, res2, next2);

      // Both should pass because they're different keys
      expect(next1).toHaveBeenCalled();
      expect(next2).toHaveBeenCalled();
    });

    it('should use custom key extractor when provided', () => {
      const middleware = createQuotaManager({
        windows: { perSecond: 1 },
        keyExtractor: (req) => req.headers['x-api-key'] as string || 'anonymous',
      });

      const { req, res, next } = createMocks({
        headers: { 'x-api-key': 'key-123' },
      } as Partial<Request>);

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('custom exceeded handler', () => {
    it('should call onExceeded when limit is hit', () => {
      const onExceeded = jest.fn();
      const middleware = createQuotaManager({
        windows: { perSecond: 1 },
        onExceeded,
      });

      const { req, res, next } = createMocks();
      middleware(req, res, next); // passes
      middleware(req, res, next); // blocked

      expect(onExceeded).toHaveBeenCalledWith(req, res, 'per-second');
      // Default 429 handler should NOT be called
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('multiple windows', () => {
    it('should enforce all configured windows', () => {
      const middleware = createQuotaManager({
        windows: {
          perSecond: 10,
          perMinute: 3, // more restrictive per-minute
        },
      });

      const { req, res, next } = createMocks();

      middleware(req, res, next); // 1 - ok
      middleware(req, res, next); // 2 - ok
      middleware(req, res, next); // 3 - ok

      // 4th request should be blocked by perMinute limit
      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(429);
    });
  });

  describe('clearQuotaStore', () => {
    it('should reset all counters', () => {
      const middleware = createQuotaManager({
        windows: { perSecond: 1 },
      });

      const { req, res, next } = createMocks();
      middleware(req, res, next); // uses the one allowed request

      clearQuotaStore();

      // After clearing, should be allowed again
      const { req: req2, res: res2, next: next2 } = createMocks();
      middleware(req2, res2, next2);
      expect(next2).toHaveBeenCalled();
    });
  });
});
