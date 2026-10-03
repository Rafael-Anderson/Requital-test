import { createHash } from 'crypto';
import { isBreachedPassword } from './breach-check';

const PW = 'correct horse battery staple 99';
const sha1 = createHash('sha1').update(PW, 'utf8').digest('hex').toUpperCase();
const PREFIX = sha1.slice(0, 5);
const SUFFIX = sha1.slice(5);
const DECOY = 'A'.repeat(35);

type FetchArgs = Parameters<typeof fetch>;

function stubFetch(impl: (...a: FetchArgs) => Promise<Response>) {
  return jest.spyOn(global, 'fetch').mockImplementation(impl);
}
const ok = (text: string, status = 200) =>
  Promise.resolve(new Response(text, { status }));

let stdout: jest.SpyInstance;
let logged: string;
beforeEach(() => {
  logged = '';
  stdout = jest
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      logged += String(chunk);
      return true;
    });
});
afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.PASSWORD_BREACH_CHECK;
  delete process.env.PASSWORD_BREACH_API_URL;
  stdout.mockRestore();
});

describe('isBreachedPassword (k-anonymity, fail open)', () => {
  it('sends ONLY the 5-char prefix, with Add-Padding, and finds the suffix locally', async () => {
    const f = stubFetch(() =>
      ok(`${DECOY}:0\n${SUFFIX}:42\n${'B'.repeat(35)}:7`),
    );
    expect(await isBreachedPassword(PW)).toBe(true);
    const [url, init] = f.mock.calls[0];
    expect(url as string).toBe(
      `https://api.pwnedpasswords.com/range/${PREFIX}`,
    );
    expect(url as string).not.toContain(SUFFIX);
    expect((init?.headers as Record<string, string>)['Add-Padding']).toBe(
      'true',
    );
    expect(init?.body).toBeUndefined();
  });

  it('a suffix with count 0 is an Add-Padding decoy, not a match', async () => {
    stubFetch(() => ok(`${SUFFIX}:0\n${DECOY}:3`));
    expect(await isBreachedPassword(PW)).toBe(false);
  });

  it('not listed means not breached, and does not warn', async () => {
    stubFetch(() => ok(`${DECOY}:3`));
    expect(await isBreachedPassword(PW)).toBe(false);
    expect(logged).not.toContain('unavailable');
  });

  it.each([
    ['HTTP 500', () => ok('boom', 500), 'status_500'],
    ['HTTP 429', () => ok('slow down', 429), 'status_429'],
    [
      'malformed body',
      () => ok('<html>not a range response</html>'),
      'malformed',
    ],
    ['empty body', () => ok(''), 'malformed'],
    [
      'network error',
      () => Promise.reject(new TypeError('fetch failed')),
      'network_error',
    ],
    [
      'timeout',
      () =>
        Promise.reject(
          Object.assign(new Error('The operation was aborted'), {
            name: 'TimeoutError',
          }),
        ),
      'timeout',
    ],
  ])(
    'fails open on %s: allowed, warns with a reason code, never throws',
    async (_n, impl, reason) => {
      stubFetch(impl);
      await expect(isBreachedPassword(PW)).resolves.toBe(false);
      expect(logged).toContain('password breach check unavailable');
      expect(logged).toContain(reason);
    },
  );

  it('never logs the password, the full hash, the prefix or the suffix', async () => {
    stubFetch(() => Promise.reject(new TypeError(`fetch failed ${PREFIX}`)));
    await isBreachedPassword(PW);
    for (const secret of [PW, sha1, SUFFIX, PREFIX, sha1.toLowerCase()]) {
      expect(logged).not.toContain(secret);
    }
  });

  it('PASSWORD_BREACH_CHECK=off makes no request at all', async () => {
    process.env.PASSWORD_BREACH_CHECK = 'off';
    const f = stubFetch(() => ok(`${SUFFIX}:1`));
    expect(await isBreachedPassword(PW)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('PASSWORD_BREACH_API_URL overrides the base URL (trailing slash optional)', async () => {
    process.env.PASSWORD_BREACH_API_URL = 'https://hibp.internal.example/range';
    const f = stubFetch(() => ok(`${DECOY}:1`));
    await isBreachedPassword(PW);
    expect(f.mock.calls[0][0] as string).toBe(
      `https://hibp.internal.example/range/${PREFIX}`,
    );
  });

  it('is case-insensitive about the suffix in the response', async () => {
    stubFetch(() => ok(`${SUFFIX.toLowerCase()}:5`));
    expect(await isBreachedPassword(PW)).toBe(true);
  });
});
