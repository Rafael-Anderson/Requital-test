import {
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
      json: async () => ({
        id: 'd1',
        status: 'not_started',
        records: [
          { record: 'DKIM', type: 'TXT', name: 'k._domainkey', value: 'p=abc' },
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
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://api.resend.com/domains');
    expect(JSON.parse(init.body)).toEqual({ name: 'roses.com' });
  });

  it('error carries the status code only, never the key or provider body', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: 'secret-key bad' }),
    });
    const err = await new ResendDomainsClient('secret-key')
      .getDomain('d1')
      .catch((e: Error) => e);
    expect(String((err as Error).message)).toBe(
      'Sending domain provider error (403)',
    );
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
