import { StructuredLoggerService } from './structured-logger.service';
import { runWithLogContext } from './log-context';

interface LogEntry {
  level: string;
  timestamp: string;
  message: string;
  context?: string;
  requestId?: string;
  shopId?: number;
  data?: Record<string, unknown>;
}

describe('StructuredLoggerService', () => {
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  function writtenLines(): string[] {
    return stdoutSpy.mock.calls.map((args: unknown[]) => String(args[0]));
  }

  function parseEntry(line: string): LogEntry {
    return JSON.parse(line) as LogEntry;
  }

  it('emits a single valid JSON line per log call', () => {
    const logger = new StructuredLoggerService();
    logger.log('hello world', 'TestContext');

    const lines = writtenLines();
    expect(lines).toHaveLength(1);
    const entry = parseEntry(lines[0]);
    expect(entry).toMatchObject({
      level: 'info',
      message: 'hello world',
      context: 'TestContext',
    });
    expect(typeof entry.timestamp).toBe('string');
  });

  it('redacts a password/token/API key when an object is logged wholesale', () => {
    const logger = new StructuredLoggerService();
    const secretPayload = {
      password: 'super-secret-password',
      apiKey: 're_live_abc123secretkey',
      token: 'not-actually-sensitive-by-name-but-shaped-like-one',
      nested: { creditCardNumber: '4111111111111111' },
    };
    logger.error({ message: 'a request failed', ...secretPayload });

    const lines = writtenLines();
    expect(lines).toHaveLength(1);
    const raw = lines[0];

    // None of the actual secret values appear anywhere in the emitted line.
    expect(raw).not.toContain('super-secret-password');
    expect(raw).not.toContain('re_live_abc123secretkey');
    expect(raw).not.toContain('4111111111111111');

    const entry = parseEntry(raw);
    const data = entry.data as {
      password: string;
      apiKey: string;
      nested: { creditCardNumber: string };
    };
    expect(data.password).toBe('[REDACTED]');
    expect(data.apiKey).toBe('[REDACTED]');
    expect(data.nested.creditCardNumber).toBe('[REDACTED]');
  });

  it('redacts a JWT-shaped or bcrypt-hash-shaped value even inside a plain string message', () => {
    const logger = new StructuredLoggerService();
    const fakeJwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const fakeBcryptHash =
      '$2b$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZabcd12';
    logger.warn(
      `unexpected auth header: Bearer ${fakeJwt}, hash=${fakeBcryptHash}`,
    );

    const raw = writtenLines()[0];
    expect(raw).not.toContain(fakeJwt);
    expect(raw).not.toContain(fakeBcryptHash);
    expect(raw).toContain('[REDACTED]');
  });

  it('enriches the log line with the current request id and shopId from log context', () => {
    const logger = new StructuredLoggerService();
    runWithLogContext({ requestId: 'req-123', shopId: 42 }, () => {
      logger.log('inside a request');
    });

    const entry = parseEntry(writtenLines()[0]);
    expect(entry.requestId).toBe('req-123');
    expect(entry.shopId).toBe(42);
  });

  it('omits requestId/shopId entirely when logged outside any request context', () => {
    const logger = new StructuredLoggerService();
    logger.log('no context here');

    const entry = parseEntry(writtenLines()[0]);
    expect(entry.requestId).toBeUndefined();
    expect(entry.shopId).toBeUndefined();
  });
});
