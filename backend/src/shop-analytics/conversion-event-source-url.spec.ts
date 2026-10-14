import { capiEventSourceUrl } from './conversion-events.service';

describe('capiEventSourceUrl', () => {
  const base = {
    shopSubdomain: 'rose',
    shopDomainType: 'subdomain',
    shopCustomDomain: null,
    shopCustomDomainStatus: null,
    id: 4242,
    trackingToken: 'A1B2C3D4E5F60718293A4B5C6D7E8F90',
  };

  it('is the shop storefront home, with no order id and no token in it', () => {
    const url = capiEventSourceUrl(base);
    expect(url).toBe('https://rose.requital.io/');
    expect(url).not.toContain('/orders');
    expect(url).not.toContain('4242');
    expect(url).not.toContain(base.trackingToken);
  });

  it('uses a verified custom domain, and never an unverified one', () => {
    expect(
      capiEventSourceUrl({
        ...base,
        shopDomainType: 'custom',
        shopCustomDomain: 'irmain.com',
        shopCustomDomainStatus: 'verified',
      }),
    ).toBe('https://irmain.com/');
    expect(
      capiEventSourceUrl({
        ...base,
        shopDomainType: 'custom',
        shopCustomDomain: 'irmain.com',
        shopCustomDomainStatus: 'pending',
      }),
    ).toBe('https://rose.requital.io/');
  });
});
