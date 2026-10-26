import { sendEmail, sendEmailStub, setSendingIdentityResolver } from './email';

describe('sendEmail', () => {
  let fetchSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  // The catch-block failure log now goes through the structured logger
  // (Phase 4), which writes JSON to process.stdout.write, not
  // console.error — sendEmailStub itself is the one deliberate exception
  // still using console.log (see its own comment), which is what logSpy
  // still covers.
  let stdoutSpy: jest.SpyInstance;
  const originalKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    stdoutSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  });

  it('falls back to the stub, without touching the network, when RESEND_API_KEY is unset', async () => {
    delete process.env.RESEND_API_KEY;

    await sendEmail('a@example.com', 'Subject', 'Body text');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[email:stub] to=a@example.com subject="Subject"',
      ),
    );
  });

  it("falls back to the stub, without touching the network, when RESEND_API_KEY is the reserved 'test' sentinel", async () => {
    process.env.RESEND_API_KEY = 'test';

    await sendEmail('a@example.com', 'Subject', 'Body text');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[email:stub] to=a@example.com subject="Subject"',
      ),
    );
  });

  it('calls the real Resend provider (not the stub) when RESEND_API_KEY is configured', async () => {
    process.env.RESEND_API_KEY = 'real-key';
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 're_1' }),
    });

    await sendEmail(
      'customer@example.com',
      'Order confirmation',
      'Thanks for your order.\n\nSee it here: https://example.com/o/1',
      {
        fromName: 'Test Shop',
      },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer real-key');
    const sentBody = JSON.parse(init.body);
    expect(sentBody.from).toBe('"Test Shop" <noreply@requital.io>');
    expect(sentBody.text).toBe(
      'Thanks for your order.\n\nSee it here: https://example.com/o/1',
    );
    // Auto-derived HTML part: paragraph-wrapped, URL linkified.
    expect(sentBody.html).toContain('<p style=');
    expect(sentBody.html).toContain('<a href="https://example.com/o/1"');
    // Real path taken — the stub must not also have logged.
    expect(logSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('[email:stub]'),
    );
  });

  it('an explicit html option is sent as-is instead of the auto-derived version', async () => {
    process.env.RESEND_API_KEY = 'real-key';
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 're_2' }),
    });

    await sendEmail('a@example.com', 'Subject', 'Body', {
      html: '<p>Custom</p>',
    });

    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sentBody.html).toBe('<p>Custom</p>');
  });

  it('falls back to stub logging (never throws) when the Resend API call fails — an invalid key included', async () => {
    process.env.RESEND_API_KEY = 'invalid-key';
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Invalid API key' }),
    });

    await expect(
      sendEmail('a@example.com', 'Subject', 'Body text'),
    ).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[email:stub] to=a@example.com subject="Subject"',
      ),
    );
    const errorLine = stdoutSpy.mock.calls
      .map((args: unknown[]) => String(args[0]))
      .find((line) => line.includes('"level":"error"'));
    expect(errorLine).toBeDefined();
    const parsed = JSON.parse(errorLine!) as { level: string; message: string };
    expect(parsed.level).toBe('error');
    expect(parsed.message).toContain('failed, falling back to stub');
  });

  it('falls back to stub logging (never throws) on a network error', async () => {
    process.env.RESEND_API_KEY = 'real-key';
    fetchSpy.mockRejectedValue(new Error('network down'));

    await expect(
      sendEmail('a@example.com', 'Subject', 'Body text'),
    ).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[email:stub] to=a@example.com subject="Subject"',
      ),
    );
  });
});

describe('sendEmailStub', () => {
  it('logs the stub line without touching the network', () => {
    const logSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    sendEmailStub('a@example.com', 'Subject', 'Body');
    expect(logSpy).toHaveBeenCalledWith(
      '[email:stub] to=a@example.com subject="Subject"\nBody',
    );
    logSpy.mockRestore();
  });
});

describe('shop sending identity (MKT-3)', () => {
  type FetchCall = [string, { body: string }];
  let fetchSpy: jest.SpyInstance;
  const originalKey = process.env.RESEND_API_KEY;
  const ok = { ok: true, json: () => Promise.resolve({ id: 're_1' }) };
  const bodyOf = (i: number) => {
    const calls = fetchSpy.mock.calls as FetchCall[];
    return JSON.parse(calls[i][1].body) as Record<string, string>;
  };
  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    process.env.RESEND_API_KEY = 're_real';
  });
  afterEach(() => {
    jest.restoreAllMocks();
    setSendingIdentityResolver(null);
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  });

  it('sends from the verified domain with Reply-To', async () => {
    fetchSpy.mockResolvedValue(ok);
    setSendingIdentityResolver(() =>
      Promise.resolve({
        fromAddress: 'noreply@roses.com',
        replyTo: 'hi@roses.com',
      }),
    );
    await sendEmail('c@example.com', 'S', 'B', {
      fromName: 'Roses',
      shopId: 7,
    });
    expect(bodyOf(0).from).toBe('"Roses" <noreply@roses.com>');
    expect(bodyOf(0).reply_to).toBe('hi@roses.com');
  });

  it('falls back to the platform address when the domain send fails', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ message: 'domain not verified' }),
      })
      .mockResolvedValueOnce(ok);
    setSendingIdentityResolver(() =>
      Promise.resolve({ fromAddress: 'noreply@roses.com' }),
    );
    await sendEmail('c@example.com', 'S', 'B', {
      fromName: 'Roses',
      shopId: 7,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(bodyOf(1).from).toBe('"Roses" <noreply@requital.io>');
    expect(bodyOf(1).reply_to).toBeUndefined();
  });

  it('falls back when the identity lookup throws', async () => {
    fetchSpy.mockResolvedValue(ok);
    setSendingIdentityResolver(() => Promise.reject(new Error('db down')));
    await sendEmail('c@example.com', 'S', 'B', {
      fromName: 'Roses',
      shopId: 7,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(bodyOf(0).from).toBe('"Roses" <noreply@requital.io>');
  });

  it('platform mail (no fromName) never uses a shop domain, shopId or not', async () => {
    fetchSpy.mockResolvedValue(ok);
    const resolver = jest.fn(() =>
      Promise.resolve({ fromAddress: 'noreply@roses.com' }),
    );
    setSendingIdentityResolver(resolver);
    await sendEmail('c@example.com', 'S', 'B', { shopId: 7 });
    expect(resolver).not.toHaveBeenCalled();
    expect(bodyOf(0).from).toBe('"Requital" <noreply@requital.io>');
  });

  it('no shopId (direct callers) never consults the resolver', async () => {
    fetchSpy.mockResolvedValue(ok);
    const resolver = jest.fn(() =>
      Promise.resolve({ fromAddress: 'noreply@roses.com' }),
    );
    setSendingIdentityResolver(resolver);
    await sendEmail('c@example.com', 'S', 'B', { fromName: 'Roses' });
    expect(resolver).not.toHaveBeenCalled();
  });
});
