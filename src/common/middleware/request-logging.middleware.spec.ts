import { Logger } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { NextFunction, Request, Response } from 'express';
import { requestLoggingMiddleware } from './request-logging.middleware';
import { getTraceId } from '../context/request-context';
import { HealthController } from '../../health/health.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

function captureLogs() {
  const lines: Array<{ level: string; payload: any }> = [];
  for (const level of ['log', 'warn', 'error'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation((payload: any) => {
      lines.push({ level, payload });
    });
  }
  return lines;
}

/** Minimal express doubles — `finish` is what the middleware logs on. */
function fakeReqRes(overrides: Partial<Request> = {}) {
  let finish: () => void = () => undefined;
  const req = {
    method: 'GET', path: '/v1/payments', query: {}, ip: '10.0.0.1',
    get: () => 'jest', ...overrides,
  } as unknown as Request;
  const res = {
    statusCode: 200,
    setHeader: jest.fn(),
    on: (event: string, cb: () => void) => { if (event === 'finish') finish = cb; },
  } as unknown as Response;
  return { req, res, finishResponse: () => finish() };
}

function run(req: Request, res: Response, next: NextFunction = () => undefined) {
  requestLoggingMiddleware(req, res, next);
}

describe('requestLoggingMiddleware', () => {
  afterEach(() => jest.restoreAllMocks());

  it('assigns a trace id, exposes it as a header, and binds it to the context', () => {
    captureLogs();
    const { req, res } = fakeReqRes();
    let seenInHandler: string | undefined;

    run(req, res, () => { seenInHandler = getTraceId(); });

    const traceId = (req as Request & { traceId: string }).traceId;
    expect(traceId).toBeTruthy();
    expect(seenInHandler).toBe(traceId);
    expect(res.setHeader).toHaveBeenCalledWith('X-Trace-Id', traceId);
  });

  it('logs one line per finished request, at a level matching the status', () => {
    const cases: Array<[number, string]> = [[200, 'log'], [401, 'warn'], [500, 'error']];
    for (const [statusCode, expectedLevel] of cases) {
      const lines = captureLogs();
      const { req, res, finishResponse } = fakeReqRes();
      (res as Response).statusCode = statusCode;

      run(req, res);
      finishResponse();

      expect(lines).toHaveLength(1);
      expect(lines[0].level).toBe(expectedLevel);
      expect(lines[0].payload).toMatchObject({ method: 'GET', path: '/v1/payments', status: statusCode });
      expect(typeof lines[0].payload.durationMs).toBe('number');
      jest.restoreAllMocks();
    }
  });

  it('redacts sensitive query keys but keeps operational ones', () => {
    const lines = captureLogs();
    const { req, res, finishResponse } = fakeReqRes({
      query: { store_id: 'str_1', token: 'secret-value' } as Request['query'],
    });

    run(req, res);
    finishResponse();

    expect(lines[0].payload.query).toEqual({ store_id: 'str_1', token: '[REDACTED]' });
    expect(JSON.stringify(lines)).not.toContain('secret-value');
  });

  describe('health probes', () => {
    // Docker polls this every 15s on two containers; logging each one would
    // bury real traffic. Read from the controller so renaming the route
    // fails this test instead of silently restoring the noise.
    const healthPath = `/${Reflect.getMetadata(PATH_METADATA, HealthController)}`;

    it('matches the route the middleware silences', () => {
      expect(healthPath).toBe('/healthz');
    });

    it('stays silent while the probe succeeds', () => {
      const lines = captureLogs();
      const { req, res, finishResponse } = fakeReqRes({ path: healthPath });

      run(req, res);
      finishResponse();

      expect(lines).toHaveLength(0);
    });

    it('logs when the probe starts failing', () => {
      const lines = captureLogs();
      const { req, res, finishResponse } = fakeReqRes({ path: healthPath });
      (res as Response).statusCode = 503;

      run(req, res);
      finishResponse();

      expect(lines).toHaveLength(1);
      expect(lines[0].level).toBe('error');
    });
  });
});
