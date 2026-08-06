import type { LoggerService } from '@nestjs/common';
import { validateEnv } from './env-validation';

function fakeLogger(): LoggerService & { errorCalls: unknown[][] } {
  const errorCalls: unknown[][] = [];
  return {
    errorCalls,
    log: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    error: (...args: unknown[]) => {
      errorCalls.push(args);
    },
  };
}

describe('validateEnv', () => {
  const ORIGINAL_ENV = { ...process.env };
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    // Baseline: every required var present and valid, so each test below
    // only needs to break the one thing it's testing.
    process.env.DATABASE_URL = 'mysql://user:pass@localhost:3306/db';
    process.env.JWT_SECRET = 'a-real-secret';
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'a-real-key';
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    exitSpy.mockRestore();
  });

  it('boots cleanly (no exit, no error log) when every required var is present and valid', () => {
    const logger = fakeLogger();
    validateEnv(logger);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(logger.errorCalls).toHaveLength(0);
  });

  it('fails fast, naming the missing var, when a required env var is absent', () => {
    delete process.env.DATABASE_URL;
    const logger = fakeLogger();
    validateEnv(logger);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logger.errorCalls).toHaveLength(1);
    const message = String(logger.errorCalls[0][0]);
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('Missing required environment variable');
  });

  it('fails fast, naming the var, when DATABASE_URL is present but malformed', () => {
    process.env.DATABASE_URL = 'not-a-connection-string';
    const logger = fakeLogger();
    validateEnv(logger);

    expect(exitSpy).toHaveBeenCalledWith(1);
    const message = String(logger.errorCalls[0][0]);
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('Invalid environment variable');
  });

  it('fails fast when PORT is present but not numeric', () => {
    process.env.PORT = 'not-a-number';
    const logger = fakeLogger();
    validateEnv(logger);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(String(logger.errorCalls[0][0])).toContain('PORT');
  });

  it('does not require optional vars (ADMIN_URL, payment gateway keys, etc.) to be present at all', () => {
    delete process.env.ADMIN_URL;
    delete process.env.STOREFRONT_URL;
    delete process.env.ERROR_TRACKING_WEBHOOK_URL;
    const logger = fakeLogger();
    validateEnv(logger);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(logger.errorCalls).toHaveLength(0);
  });

  it('still validates the shape of an optional var when it IS present', () => {
    process.env.ADMIN_URL = 'not a url at all';
    const logger = fakeLogger();
    validateEnv(logger);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(String(logger.errorCalls[0][0])).toContain('ADMIN_URL');
  });

  it('fails fast when STORAGE_PROVIDER is present but neither "local" nor "s3"', () => {
    process.env.STORAGE_PROVIDER = 'dropbox';
    const logger = fakeLogger();
    validateEnv(logger);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(String(logger.errorCalls[0][0])).toContain('STORAGE_PROVIDER');
  });

  it('accepts STORAGE_PROVIDER=s3 by itself — the S3_* vars-required-together check happens at StorageModule registration, not here', () => {
    process.env.STORAGE_PROVIDER = 's3';
    const logger = fakeLogger();
    validateEnv(logger);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(logger.errorCalls).toHaveLength(0);
  });

  it('reports every broken var in one pass, not just the first', () => {
    delete process.env.JWT_SECRET;
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    const logger = fakeLogger();
    validateEnv(logger);

    const message = String(logger.errorCalls[0][0]);
    expect(message).toContain('JWT_SECRET');
    expect(message).toContain('CREDENTIAL_ENCRYPTION_KEY');
  });
});
