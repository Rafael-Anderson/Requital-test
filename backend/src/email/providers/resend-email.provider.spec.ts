import { ResendEmailProvider } from './resend-email.provider';
import type { SendEmailParams } from '../email-provider.interface';

describe('ResendEmailProvider', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('formats and sends a real request against the Resend API', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 're_fake123' }),
    });

    const provider = new ResendEmailProvider();
    const result = await provider.sendEmail({
      to: 'customer@example.com',
      subject: 'Order confirmation #42',
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
    expect(sentBody.from).toBe('"Test Shop" <noreply@requital.io>');
    expect(sentBody).not.toHaveProperty('reply_to');
    expect(sentBody.to).toBe('customer@example.com');
    expect(sentBody.subject).toBe('Order confirmation #42');
    expect(sentBody.text).toBe('Thanks for your order.');
    expect(sentBody.html).toBe('<p>Thanks for your order.</p>');

    expect(result).toEqual({ providerReference: 're_fake123' });
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
    });

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

  describe('From header (MKT-3)', () => {
    type FetchCall = [string, { body: string }];
    const send = async (extra: Partial<SendEmailParams>) => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'x' }),
      });
      await new ResendEmailProvider().sendEmail({
        to: 'c@example.com',
        subject: 's',
        text: 't',
        html: '<p>t</p>',
        fromName: 'Rose Shop',
        credentials: { apiKey: 'k' },
        ...extra,
      });
      const calls = fetchSpy.mock.calls as FetchCall[];
      return JSON.parse(calls[0][1].body) as Record<string, string>;
    };

    it('uses the shop domain address and Reply-To when given', async () => {
      const body = await send({
        fromAddress: 'noreply@roses.com',
        replyTo: 'hello@roses.com',
      });
      expect(body.from).toBe('"Rose Shop" <noreply@roses.com>');
      expect(body.reply_to).toBe('hello@roses.com');
    });

    it.each([
      [
        'CRLF header injection',
        'Evil\r\nBcc: x@y.com',
        '"Evil Bcc: x@y.com" <noreply@requital.io>',
      ],
      [
        'quote breakout',
        'A" <attacker@evil.com>, "B',
        '"A attacker@evil.com , B" <noreply@requital.io>',
      ],
      ['empty after cleaning', '\r\n""', '"Requital" <noreply@requital.io>'],
    ])('sanitises the display name: %s', async (_n, name, expected) => {
      const body = await send({ fromName: name });
      expect(body.from).toBe(expected);
      expect(body.from).not.toMatch(/[\r\n]/);
    });
  });
});
