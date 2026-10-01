import { MetaCapiClient } from './meta-capi.client';

const TOKEN = 'EAABsecretTOKENvalue1234567890abcdef';

describe('MetaCapiClient', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('puts the token in the body, never in the URL, and posts to the pixel events endpoint', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;
    await new MetaCapiClient().send({
      pixelId: '123456789',
      accessToken: TOKEN,
      events: [{ event_name: 'Purchase' }],
      testEventCode: 'TEST1',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/graph\.facebook\.com\/v[\d.]+\/123456789\/events$/);
    expect(url).not.toContain(TOKEN);
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent.access_token).toBe(TOKEN);
    expect(sent.test_event_code).toBe('TEST1');
  });

  it('a failure message carries status and Meta error codes but never the token or the response body', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: {
            message: `Invalid OAuth access token ${TOKEN}`,
            code: 190,
            error_subcode: 463,
            type: 'OAuthException',
          },
        }),
    }) as unknown as typeof fetch;
    const err = await new MetaCapiClient()
      .send({ pixelId: '1', accessToken: TOKEN, events: [] })
      .catch((e: Error) => e);
    expect((err as Error).message).toContain('HTTP 400');
    expect((err as Error).message).toContain('code=190');
    expect((err as Error).message).not.toContain(TOKEN);
  });

  it('a network error is rethrown without the original error text', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error(`connect failed for ${TOKEN}`)) as unknown as typeof fetch;
    const err = await new MetaCapiClient()
      .send({ pixelId: '1', accessToken: TOKEN, events: [] })
      .catch((e: Error) => e);
    expect((err as Error).message).not.toContain(TOKEN);
  });
});
