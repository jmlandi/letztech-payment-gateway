import { loggerParams } from './logger.config';
import { runWithContext } from '../context/request-context';

/* eslint-disable @typescript-eslint/no-explicit-any */

const pinoHttp = (env: NodeJS.ProcessEnv) => loggerParams(env).pinoHttp as any;

describe('loggerParams', () => {
  it('emits raw JSON in production and pretty-prints elsewhere', () => {
    expect(pinoHttp({ NODE_ENV: 'production' }).transport).toBeUndefined();
    expect(pinoHttp({ NODE_ENV: 'development' }).transport.target).toBe('pino-pretty');
  });

  it('defaults level by environment and honours LOG_LEVEL', () => {
    expect(pinoHttp({ NODE_ENV: 'production' }).level).toBe('info');
    expect(pinoHttp({ NODE_ENV: 'development' }).level).toBe('debug');
    expect(pinoHttp({ NODE_ENV: 'production', LOG_LEVEL: 'warn' }).level).toBe('warn');
  });

  it('leaves request logging to the middleware, so lines are not duplicated', () => {
    expect(pinoHttp({}).autoLogging).toBe(false);
  });

  describe('mixin', () => {
    it('stamps the active trace id onto every line', () => {
      const { mixin } = pinoHttp({});
      const stamped = runWithContext({ traceId: 'trace_xyz' }, () => mixin());
      expect(stamped).toEqual({ traceId: 'trace_xyz' });
    });

    it('adds nothing outside a request (cron relay, worker jobs)', () => {
      expect(pinoHttp({}).mixin()).toEqual({});
    });
  });

  describe('redact paths', () => {
    const paths: string[] = pinoHttp({}).redact.paths;

    // pino's `*` spans exactly one level, so a key listed only as `*.key` slips
    // through when it sits at the root — which is how a top-level taxpayer_id
    // reached the log before this was fixed.
    it.each(['taxpayer_id', 'token', 'token_id', 'cvv', 'password', 'cpf', 'cnpj', 'card_number'])(
      'covers %s both at the root and one level down',
      (key) => {
        expect(paths).toContain(key);
        expect(paths).toContain(`*.${key}`);
      },
    );

    it('covers the provider credential headers', () => {
      expect(paths).toContain('req.headers.authorization');
      expect(paths).toContain('req.headers["x-api-key"]');
    });

    it('censors with the same marker the redact util uses', () => {
      expect(pinoHttp({}).redact.censor).toBe('[REDACTED]');
    });
  });
});
