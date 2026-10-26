import {
  ALREADY_REGISTERED,
  NotConfiguredSendingDomainsClient,
  ResendDomainsClient,
} from './sending-domains.client';
import { mapProviderStatus } from './sending-domain-platform-assumptions';

describe('ResendDomainsClient (fetch mocked, UNVERIFIED shapes)', () => {
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  it('creates a domain and maps records without leaking the key', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'd1',
          status: 'not_started',
          records: [
            {
              record: 'DKIM',
              type: 'TXT',
              name: 'k._domainkey',
              value: 'p=abc',
            },
          ],
        }),
    });
    const out = await new ResendDomainsClient('secret-key').createDomain(
      'roses.com',
    );
    expect(out).toEqual({
      providerId: 'd1',
      status: 'pending',
      records: [
        { type: 'TXT', name: 'k._domainkey', value: 'p=abc', label: 'DKIM' },
      ],
    });
    const [url, init] = (
      fetchSpy.mock.calls as [string, { body: string }][]
    )[0];
    expect(url).toBe('https://api.resend.com/domains');
    expect(JSON.parse(init.body) as unknown).toEqual({ name: 'roses.com' });
  });

  it('error carries the status code only, never the key or provider body', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ message: 'secret-key bad' }),
    });
    const err = await new ResendDomainsClient('secret-key')
      .getDomain('d1')
      .catch((e: Error) => e);
    expect(String((err as Error).message)).toBe(
      'Sending domain provider error (403)',
    );
  });

  it('passes an abort signal so a hung provider cannot hold the request', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'd1', status: 'pending', records: [] }),
    });
    await new ResendDomainsClient('k').getDomain('d1');
    const init = (
      fetchSpy.mock.calls as [string, { signal?: AbortSignal }][]
    )[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('a network/timeout failure becomes a generic 503 with no detail', async () => {
    fetchSpy.mockRejectedValue(new Error('connect ETIMEDOUT secret-key'));
    const err = await new ResendDomainsClient('secret-key')
      .getDomain('d1')
      .catch((e: Error) => e);
    expect((err as Error).message).toBe('Sending domain provider unreachable');
  });

  it.each([409, 422])(
    'create answering %s maps to the clear already-registered message',
    async (status) => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status,
        json: () => Promise.resolve({ message: 'x' }),
      });
      const err = await new ResendDomainsClient('k')
        .createDomain('roses.com')
        .catch((e: Error) => e);
      expect((err as Error).message).toBe(ALREADY_REGISTERED);
    },
  );

  it('a 500 on create stays a generic provider error', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });
    const err = await new ResendDomainsClient('k')
      .createDomain('roses.com')
      .catch((e: Error) => e);
    expect((err as Error).message).toBe('Sending domain provider error (500)');
  });

  it('maps statuses: only the exact verified string verifies', () => {
    expect(mapProviderStatus('verified')).toBe('verified');
    expect(mapProviderStatus('failed')).toBe('failed');
    expect(mapProviderStatus('pending')).toBe('pending');
    expect(mapProviderStatus('VERIFIED')).toBe('pending');
    expect(mapProviderStatus(undefined)).toBe('pending');
  });

  it('NotConfigured client refuses every call', async () => {
    await expect(
      new NotConfiguredSendingDomainsClient().createDomain(),
    ).rejects.toThrow('not available');
  });
});
