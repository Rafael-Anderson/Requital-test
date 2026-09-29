import { resolveCanonicalOrigin, storefrontUrl } from './storefront-url';

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

// storefrontUrl() is what every consumer now calls. The origin resolution above
// is the same function, so these cover the path-joining and the dev branch.
describe('storefrontUrl', () => {
  const ORIGINAL = process.env.STOREFRONT_URL;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.STOREFRONT_URL;
    else process.env.STOREFRONT_URL = ORIGINAL;
    jest.resetModules();
  });

  it('builds a host-based URL with NO slug in the path', () => {
    // The slug is the host. proxy.ts prepends it back on the way in; including
    // it here is what produced the 404s (dff.requital.io/dff/orders/3).
    expect(storefrontUrl(base, '/orders/3?paid=1')).toBe(
      'https://arabian-petals.requital.io/orders/3?paid=1',
    );
  });

  it('uses a verified custom domain, still without a slug', () => {
    expect(
      storefrontUrl(
        {
          ...base,
          domainType: 'custom',
          customDomain: 'irmain.com',
          customDomainStatus: 'verified',
        },
        '/orders/13?paid=1',
      ),
    ).toBe('https://irmain.com/orders/13?paid=1');
  });

  // The live production case: paradise-blooms has domainType='custom' with a
  // NULL status, and its claimed domain serves an unrelated third-party site.
  it('never sends a customer to an unverified custom domain', () => {
    const url = storefrontUrl(
      {
        subdomain: 'paradise-blooms',
        domainType: 'custom',
        customDomain: 'arabianrentals.com',
        customDomainStatus: null,
      },
      '/orders/1?paid=1',
    );
    expect(url).toBe('https://paradise-blooms.requital.io/orders/1?paid=1');
    expect(url).not.toContain('arabianrentals.com');
  });

  it('tolerates a path with no leading slash', () => {
    expect(storefrontUrl(base, 'orders/3')).toBe(
      'https://arabian-petals.requital.io/orders/3',
    );
  });

  it('never produces the apex host that redirected to admin', () => {
    const url = storefrontUrl(base, '/checkout');
    expect(url).not.toMatch(/^https:\/\/requital\.io\//);
    expect(url).not.toContain('admin.');
  });
});

// The dev branch. proxy.ts passes local hosts straight through WITHOUT
// prepending a slug, so the path form is the only shape a local host serves —
// and a NON-local STOREFRONT_URL must be ignored, which is what makes
// production's apex value inert rather than wrong.
describe('storefrontUrl dev branch', () => {
  const ORIGINAL = process.env.STOREFRONT_URL;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.STOREFRONT_URL;
    else process.env.STOREFRONT_URL = ORIGINAL;
  });

  it.each(['http://localhost:3002', 'http://127.0.0.1:3002', 'http://my-box.local:3002'])(
    'keeps the slug in the path for the local host %s',
    (devBase) => {
      process.env.STOREFRONT_URL = devBase;
      expect(storefrontUrl(base, '/orders/3')).toBe(
        `${devBase}/arabian-petals/orders/3`,
      );
    },
  );

  it('ignores a NON-local STOREFRONT_URL — the production apex must not win', () => {
    // This exact value is live on the VPS, and the apex 301-redirects to
    // admin.requital.io. Ignoring it is what makes the misconfiguration inert.
    process.env.STOREFRONT_URL = 'https://requital.io';
    expect(storefrontUrl(base, '/orders/3')).toBe(
      'https://arabian-petals.requital.io/orders/3',
    );
  });

  it('ignores an unparseable STOREFRONT_URL rather than throwing', () => {
    process.env.STOREFRONT_URL = 'not a url';
    expect(storefrontUrl(base, '/orders/3')).toBe(
      'https://arabian-petals.requital.io/orders/3',
    );
  });

  it('strips a trailing slash so the path never doubles it', () => {
    process.env.STOREFRONT_URL = 'http://localhost:3002/';
    expect(storefrontUrl(base, '/orders/3')).toBe(
      'http://localhost:3002/arabian-petals/orders/3',
    );
  });

  it('mirrors storefront/lib/is-local-host.ts exactly — no broader matches', () => {
    // Deliberately NOT treated as local by that file, so not here either.
    for (const notLocal of ['http://localhost.evil.com', 'http://0.0.0.0:3002']) {
      process.env.STOREFRONT_URL = notLocal;
      expect(storefrontUrl(base, '/x')).toBe(
        'https://arabian-petals.requital.io/x',
      );
    }
  });
});
