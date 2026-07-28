import { ResendEmailProvider } from './resend-email.provider';

describe('ResendEmailProvider', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.EMAIL_FROM_ADDRESS;
  });

  it('formats and sends a real request against the Resend API', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 're_fake123' }),
    } as unknown as Response);

    const provider = new ResendEmailProvider();
    const result = await provider.sendEmail({
      to: 'customer@example.com',
      subject: 'Order confirmation — #42',
      text: 'Thanks for your order.',
      html: '<p>Thanks for your order.</p>',
      fromName: 'Test Shop',
      credentials: { apiKey: 'fake-api-key' },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer fake-api-key');
    expect(init.headers['Content-Type']).toBe('application/json');

    const sentBody = JSON.parse(init.body);
    expect(sentBody.from).toBe('Test Shop <notifications@requital.app>');
    expect(sentBody.to).toBe('customer@example.com');
    expect(sentBody.subject).toBe('Order confirmation — #42');
    expect(sentBody.text).toBe('Thanks for your order.');
    expect(sentBody.html).toBe('<p>Thanks for your order.</p>');

    expect(result).toEqual({ providerReference: 're_fake123' });
  });

  it('uses EMAIL_FROM_ADDRESS when set, keeping the caller-supplied display name', async () => {
    process.env.EMAIL_FROM_ADDRESS = 'orders@verified-domain.com';
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ id: 're_2' }) } as unknown as Response);

    const provider = new ResendEmailProvider();
    await provider.sendEmail({
      to: 'a@example.com',
      subject: 'Subject',
      text: 'Text',
      html: '<p>Text</p>',
      fromName: 'Requital',
      credentials: { apiKey: 'key' },
    });

    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sentBody.from).toBe('Requital <orders@verified-domain.com>');
  });

  it('throws when the API key is missing', async () => {
    const provider = new ResendEmailProvider();
    await expect(
      provider.sendEmail({
        to: 'a@example.com',
        subject: 'Subject',
        text: 'Text',
        html: '<p>Text</p>',
        fromName: 'Requital',
        credentials: { apiKey: '' },
      }),
    ).rejects.toThrow('Resend API key is missing');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws with the Resend error message when the API responds non-OK', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Invalid API key' }),
    } as unknown as Response);

    const provider = new ResendEmailProvider();
    await expect(
      provider.sendEmail({
        to: 'a@example.com',
        subject: 'Subject',
        text: 'Text',
        html: '<p>Text</p>',
        fromName: 'Requital',
        credentials: { apiKey: 'bad-key' },
      }),
    ).rejects.toThrow('Resend API error (401): Invalid API key');
  });
});
