import { sendPlatformWhatsAppAlertOrThrow, sendWhatsAppStub } from './whatsapp';

describe('sendPlatformWhatsAppAlertOrThrow', () => {
  let fetchSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  const originalPhoneNumberId = process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID;
  const originalAccessToken = process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    logSpy.mockRestore();
    if (originalPhoneNumberId === undefined) {
      delete process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID;
    } else {
      process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = originalPhoneNumberId;
    }
    if (originalAccessToken === undefined) {
      delete process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN;
    } else {
      process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = originalAccessToken;
    }
  });

  it('falls back to the stub, without touching the network, when the platform credentials are unset', async () => {
    delete process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN;

    await sendPlatformWhatsAppAlertOrThrow('+971501234567', 'New order #1');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[whatsapp:stub] to=+971501234567'),
    );
  });

  it('falls back to the stub when only one of the two platform env vars is set', async () => {
    process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = '12345';
    delete process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN;

    await sendPlatformWhatsAppAlertOrThrow('+971501234567', 'New order #1');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls MetaWhatsAppProvider with env-sourced credentials when the platform vars are configured', async () => {
    process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = '12345';
    process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = 'platform-token';
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.1' }] }),
    });

    await sendPlatformWhatsAppAlertOrThrow('+971501234567', 'New order #1');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('/12345/messages');
    expect(init.headers.Authorization).toBe('Bearer platform-token');
    const sentBody = JSON.parse(init.body);
    expect(sentBody.to).toBe('971501234567');
    expect(sentBody.text.body).toBe('New order #1');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('propagates a real send failure (does not swallow it) — the queue relies on this to retry', async () => {
    process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = '12345';
    process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = 'bad-token';
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Invalid token',
    });

    await expect(
      sendPlatformWhatsAppAlertOrThrow('+971501234567', 'New order #1'),
    ).rejects.toThrow();
  });
});

describe('sendWhatsAppStub', () => {
  it('logs the stub line without touching the network', () => {
    const logSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    sendWhatsAppStub('+971501234567', 'Body text');
    expect(logSpy).toHaveBeenCalledWith(
      '[whatsapp:stub] to=+971501234567\nBody text',
    );
    logSpy.mockRestore();
  });
});
