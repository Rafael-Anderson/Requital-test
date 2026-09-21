import { resolveCanonicalOrigin } from './canonical-origin';

const base = {
  subdomain: 'arabian-petals',
  domainType: 'subdomain' as string | null,
  customDomain: null as string | null,
  customDomainStatus: null as string | null,
};

describe('resolveCanonicalOrigin', () => {
  it('uses the shop subdomain by default', () => {
    expect(resolveCanonicalOrigin(base)).toBe(
      'https://arabian-petals.requital.io',
    );
  });

  it('uses a verified custom domain', () => {
    expect(
      resolveCanonicalOrigin({
        ...base,
        domainType: 'custom',
        customDomain: 'irmain.com',
        customDomainStatus: 'verified',
      }),
    ).toBe('https://irmain.com');
  });

  // The important case. An unverified claim is not served at all
  // (DomainsService.resolveSubdomain gates on 'verified'), so canonicalising
  // to it would point every crawler at a host that 404s - worse than having
  // no canonical tag. admin's storefrontUrlFor does NOT make this
  // distinction, which is why this is its own function rather than a shared
  // one.
  it.each(['pending', 'verifying', 'failed', null])(
    'falls back to the subdomain when the custom domain status is %s',
    (status) => {
      expect(
        resolveCanonicalOrigin({
          ...base,
          domainType: 'custom',
          customDomain: 'irmain.com',
          customDomainStatus: status,
        }),
      ).toBe('https://arabian-petals.requital.io');
    },
  );

  it('falls back when domainType says custom but no domain is set', () => {
    expect(
      resolveCanonicalOrigin({
        ...base,
        domainType: 'custom',
        customDomain: null,
        customDomainStatus: 'verified',
      }),
    ).toBe('https://arabian-petals.requital.io');
  });
});
