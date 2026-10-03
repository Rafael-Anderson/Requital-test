import {
  canonicalizeRequestPath,
  checkChain,
  normalizeNotFoundPath,
  referrerHost,
  resolveRedirect,
  validateFromPath,
  validateStatusCode,
  validateTarget,
  type RedirectEntry,
} from './redirect-rules';

const HOSTS = ['acme.requital.io', 'shop.acme.com'];

function entry(
  from: string,
  to: string,
  status = 301,
  active = true,
): RedirectEntry {
  return { fromPath: from, toTarget: to, statusCode: status, active };
}
function mapOf(...entries: RedirectEntry[]) {
  return new Map(entries.map((e) => [e.fromPath, e]));
}
function accepted(target: string) {
  return validateTarget(target, HOSTS).ok;
}

describe('validateFromPath', () => {
  it('canonicalises case, trailing slash and percent-encoding', () => {
    const lower = validateFromPath('/products/rose');
    expect(lower).toEqual({ ok: true, value: '/products/rose' });
    expect(validateFromPath('/Products/Rose/')).toEqual(lower);
    expect(validateFromPath('/products/ro%73e')).toEqual(lower);
  });

  it('treats a raw and an encoded non-ASCII segment as the same entry', () => {
    const raw = validateFromPath(
      '/products/' + String.fromCharCode(0x0639, 0x0637, 0x0631),
    );
    const encoded = validateFromPath('/products/%D8%B9%D8%B7%D8%B1');
    expect(raw.ok && encoded.ok && raw.value === encoded.value).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['products/x', 'no leading slash'],
    ['//evil.com/x', 'protocol-relative'],
    ['/', 'the home page'],
    ['/x?id=1', 'query string'],
    ['/x#frag', 'fragment'],
    ['/x\\y', 'backslash'],
    ['/x/%2f/y', 'encoded slash in a segment'],
    ['/x/%5c', 'encoded backslash'],
    ['/a//b', 'empty middle segment'],
    ['/a/../b', 'dot segment'],
    ['/a/%2e%2e/b', 'encoded dot segment'],
    ['/x\ty', 'tab'],
    ['/x\ny', 'newline'],
    ['/x y', 'space'],
    ['/x%00y', 'encoded NUL'],
    ['/x%zz', 'malformed escape'],
    ['/' + 'a'.repeat(600), 'too long'],
  ])('rejects %j (%s)', (input) => {
    expect(validateFromPath(input).ok).toBe(false);
  });

  it.each([
    '/_next/static/x',
    '/api/public/x',
    '/checkout',
    '/Cart',
    '/account/login',
    '/pay',
    '/admin',
    '/.well-known/x',
    '/sitemap.xml',
  ])('refuses the reserved storefront route %s', (input) => {
    expect(validateFromPath(input).ok).toBe(false);
  });

  it('does not treat a longer name that merely starts like a reserved one as reserved', () => {
    expect(validateFromPath('/cartridges').ok).toBe(true);
    expect(validateFromPath('/apiary').ok).toBe(true);
  });
});

describe('validateTarget: same-origin paths', () => {
  it.each([
    '/products/new',
    '/collections/all?sort=price',
    '/a/b#c',
    '/x%20y',
    '/',
  ])('accepts %s', (target) => {
    expect(accepted(target)).toBe(true);
  });

  it.each([
    ['//evil.com', 'protocol-relative'],
    ['///evil.com', 'triple slash'],
    ['/\\evil.com', 'slash backslash'],
    ['\\\\evil.com', 'double backslash'],
    ['/\\/evil.com', 'mixed'],
    ['/%2Fevil.com', 'encoded second slash'],
    ['/%2fevil.com', 'encoded second slash lower-case'],
    ['/%5Cevil.com', 'encoded backslash'],
    ['/%5cevil.com', 'encoded backslash lower-case'],
    ['/%252Fevil.com', 'double-encoded slash'],
    ['/%255Cevil.com', 'double-encoded backslash'],
    ['/%25252Fevil.com', 'triple-encoded slash'],
    ['/\tevil.com', 'raw tab'],
    ['/\t/evil.com', 'tab between slashes'],
    ['/\r\n/evil.com', 'CRLF'],
    ['/%09/evil.com', 'encoded tab'],
    ['/%0d%0a/evil.com', 'encoded CRLF'],
    ['/%0A/evil.com', 'encoded LF'],
    ['/' + String.fromCharCode(0x2028) + '/evil.com', 'line separator'],
    ['/' + String.fromCharCode(0x200b) + '/evil.com', 'zero-width space'],
    ['/%E2%80%A8/evil.com', 'encoded line separator'],
    ['/a b', 'space'],
    ['/x%zz', 'malformed escape'],
    ['evil.com', 'bare host'],
    ['javascript:alert(1)', 'javascript scheme'],
    ['JaVaScRiPt:alert(1)', 'mixed-case javascript scheme'],
    ['data:text/html,<script>alert(1)</script>', 'data scheme'],
    ['vbscript:x', 'vbscript scheme'],
    ['mailto:a@b.com', 'mailto'],
    ['ftp://acme.requital.io/x', 'ftp'],
    ['/' + 'a'.repeat(2100), 'too long'],
    ['', 'empty'],
  ])('rejects %j (%s)', (target) => {
    expect(accepted(target)).toBe(false);
  });
});

describe('validateTarget: absolute URLs', () => {
  it('accepts the shop subdomain host and the verified custom domain', () => {
    expect(accepted('https://acme.requital.io/products/x')).toBe(true);
    expect(accepted('http://acme.requital.io/')).toBe(true);
    expect(accepted('https://shop.acme.com/products/x?a=1')).toBe(true);
    expect(accepted('HTTPS://ACME.REQUITAL.IO/x')).toBe(true);
  });

  it('normalises the host the way the URL parser does', () => {
    const r = validateTarget('https://ACME.requital.io/X', HOSTS);
    expect(r.ok && r.value.value).toBe('https://acme.requital.io/X');
  });

  it.each([
    ['https://evil.com/x', 'another site'],
    ['https://acme.requital.io.evil.com/x', 'suffix lookalike'],
    ['https://evilacme.requital.io/x', 'prefix lookalike'],
    ['https://evil-acme.requital.io/x', 'sibling subdomain'],
    ['https://other.requital.io/x', 'another shop'],
    ['https://requital.io/x', 'the apex'],
    ['https://admin.requital.io/x', 'admin host'],
    ['https://api.requital.io/x', 'api host'],
    ['https://user@acme.requital.io/x', 'userinfo'],
    ['https://user:pw@acme.requital.io/x', 'userinfo with password'],
    ['https://evil.com@acme.requital.io/x', 'userinfo that looks like a host'],
    ['https://acme.requital.io@evil.com/x', 'real host after @'],
    ['https://acme.requital.io:8443/x', 'explicit port'],
    ['https://acme.requital.io:443/x', 'explicit default port (still refused)'],
    ['https://acme.requital.io\\@evil.com/x', 'backslash trick'],
    ['https://evil.com\\.acme.requital.io/x', 'backslash host split'],
    ['https://acme.requital.io%2f@evil.com/x', 'encoded slash before @'],
    [
      'https://acme.requital.io/%0d%0aSet-Cookie:x',
      'is a same-host path (encoded CRLF is data, not a header)',
    ],
    ['https:acme.requital.io/x', 'missing slashes'],
    ['http://[::1]/x', 'IPv6 literal'],
    ['http://127.0.0.1/x', 'loopback'],
    ['https://xn--acme-9ua.requital.io/x', 'punycode lookalike'],
  ])('rejects %j (%s)', (target, why) => {
    // The encoded-CRLF case is a path on our own host: it is ACCEPTED (it only
    // carries data in a path), and is listed here to document that distinction.
    if (why.startsWith('is a same-host path')) {
      expect(accepted(target)).toBe(true);
    } else {
      expect(accepted(target)).toBe(false);
    }
  });

  it('stops accepting a custom domain once it is no longer one of the shop hosts', () => {
    expect(validateTarget('https://shop.acme.com/x', HOSTS).ok).toBe(true);
    expect(
      validateTarget('https://shop.acme.com/x', ['acme.requital.io']).ok,
    ).toBe(false);
  });
});

describe('validateStatusCode', () => {
  it('allows only 301 and 302', () => {
    expect(validateStatusCode(301).ok).toBe(true);
    expect(validateStatusCode(302).ok).toBe(true);
    for (const bad of [200, 303, 307, 308, 404, '301', null, undefined, NaN]) {
      expect(validateStatusCode(bad).ok).toBe(false);
    }
  });
});

describe('canonicalizeRequestPath', () => {
  it('matches what validateFromPath stored', () => {
    expect(canonicalizeRequestPath('/Products/Rose/')).toBe('/products/rose');
    expect(canonicalizeRequestPath('/products/rose?utm=1#x')).toBe(
      '/products/rose',
    );
  });
  it('never throws and returns null for garbage', () => {
    expect(canonicalizeRequestPath('/%zz')).toBeNull();
    expect(canonicalizeRequestPath('/a//b')).toBeNull();
    expect(canonicalizeRequestPath('/a/%2f/b')).toBeNull();
    expect(canonicalizeRequestPath('x'.repeat(5000))).toBeNull();
  });
});

describe('checkChain', () => {
  const target = (t: string) => {
    const r = validateTarget(t, HOSTS);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };

  it('rejects from == to, ignoring a query string on the target', () => {
    expect(checkChain('/a', target('/a'), mapOf(), HOSTS)).toMatch(/same page/);
    expect(checkChain('/a', target('/a?x=1'), mapOf(), HOSTS)).toMatch(
      /same page/,
    );
    expect(
      checkChain('/a', target('https://acme.requital.io/A/'), mapOf(), HOSTS),
    ).toMatch(/same page/);
  });

  it('detects a two-step loop a -> b -> a', () => {
    expect(
      checkChain('/a', target('/b'), mapOf(entry('/b', '/a')), HOSTS),
    ).toMatch(/loop/);
  });

  it('detects a longer loop', () => {
    const existing = mapOf(
      entry('/b', '/c'),
      entry('/c', '/d'),
      entry('/d', '/a'),
    );
    expect(checkChain('/a', target('/b'), existing, HOSTS)).toMatch(/loop/);
  });

  it('ignores inactive rows', () => {
    expect(
      checkChain(
        '/a',
        target('/b'),
        mapOf(entry('/b', '/a', 301, false)),
        HOSTS,
      ),
    ).toBeNull();
  });

  it('rejects a chain that is too long and accepts a short one', () => {
    const long = mapOf(
      entry('/b', '/c'),
      entry('/c', '/d'),
      entry('/d', '/e'),
      entry('/e', '/f'),
    );
    expect(checkChain('/a', target('/b'), long, HOSTS)).toMatch(/longer than/);
    expect(
      checkChain('/a', target('/b'), mapOf(entry('/b', '/c')), HOSTS),
    ).toBeNull();
  });

  it('does not walk through a stored target that is no longer valid', () => {
    expect(
      checkChain(
        '/a',
        target('/b'),
        mapOf(entry('/b', 'https://evil.com/a')),
        HOSTS,
      ),
    ).toBeNull();
  });
});

describe('resolveRedirect', () => {
  it('returns the target and status for an active entry', () => {
    expect(
      resolveRedirect('/old', mapOf(entry('/old', '/new', 302)), HOSTS),
    ).toEqual({
      to: '/new',
      status: 302,
    });
  });

  it('returns null for no entry, an inactive entry, or a self-redirect', () => {
    expect(resolveRedirect('/x', mapOf(), HOSTS)).toBeNull();
    expect(
      resolveRedirect('/old', mapOf(entry('/old', '/new', 301, false)), HOSTS),
    ).toBeNull();
    expect(
      resolveRedirect('/old', mapOf(entry('/old', '/old?x=1')), HOSTS),
    ).toBeNull();
  });

  it('collapses exactly one extra hop and never more', () => {
    const entries = mapOf(
      entry('/a', '/b'),
      entry('/b', '/c'),
      entry('/c', '/d'),
    );
    expect(resolveRedirect('/a', entries, HOSTS)).toEqual({
      to: '/c',
      status: 301,
    });
  });

  it('a single temporary hop makes the collapsed redirect temporary', () => {
    const entries = mapOf(entry('/a', '/b'), entry('/b', '/c', 302));
    expect(resolveRedirect('/a', entries, HOSTS)?.status).toBe(302);
  });

  it('never bounces back to the page that was asked for (a -> b -> a)', () => {
    const entries = mapOf(entry('/a', '/b'), entry('/b', '/a'));
    expect(resolveRedirect('/a', entries, HOSTS)).toEqual({
      to: '/b',
      status: 301,
    });
    expect(resolveRedirect('/b', entries, HOSTS)).toEqual({
      to: '/a',
      status: 301,
    });
  });

  it('terminates on a long cycle', () => {
    const entries = mapOf(
      entry('/a', '/b'),
      entry('/b', '/c'),
      entry('/c', '/a'),
    );
    expect(resolveRedirect('/a', entries, HOSTS)?.to).toBe('/c');
  });

  it('RE-VALIDATES the stored target at resolve time: a disconnected custom domain stops redirecting', () => {
    const entries = mapOf(entry('/old', 'https://shop.acme.com/new'));
    expect(resolveRedirect('/old', entries, HOSTS)?.to).toBe(
      'https://shop.acme.com/new',
    );
    expect(resolveRedirect('/old', entries, ['acme.requital.io'])).toBeNull();
  });

  it('refuses a stored target that was written by some other route and is unsafe', () => {
    for (const bad of [
      '//evil.com',
      'https://evil.com',
      'javascript:alert(1)',
      '/\\evil.com',
    ]) {
      expect(
        resolveRedirect('/old', mapOf(entry('/old', bad)), HOSTS),
      ).toBeNull();
    }
  });

  it('does not collapse into an unsafe second hop', () => {
    const entries = mapOf(entry('/a', '/b'), entry('/b', '//evil.com'));
    expect(resolveRedirect('/a', entries, HOSTS)).toEqual({
      to: '/b',
      status: 301,
    });
  });
});

describe('normalizeNotFoundPath and referrerHost (log poisoning)', () => {
  it('stores only a canonical path, never a query string', () => {
    expect(
      normalizeNotFoundPath('/Old/Page?email=a@b.com&token=secret#x'),
    ).toBe('/old/page');
  });
  it.each([
    '',
    'x',
    '//evil.com',
    '/',
    '/_next/x',
    '/api/x',
    '/a\nb',
    '/a\tb',
    '/a%00b',
    '/%zz',
    '/a//b',
  ])('does not log %j', (input) => {
    expect(normalizeNotFoundPath(input)).toBeNull();
  });
  it('output only ever contains URL-safe characters (no markup can be stored)', () => {
    const out = normalizeNotFoundPath(
      '/<script>alert(1)</script>/"onmouseover=x',
    );
    expect(out).not.toBeNull();
    expect(out).toMatch(/^[A-Za-z0-9\-_.!~*'()%/]+$/);
  });
  it('reduces a referrer to its host', () => {
    expect(referrerHost('https://Google.com/search?q=secret#frag')).toBe(
      'google.com',
    );
    expect(referrerHost('https://user:pw@example.com:8080/x')).toBe(
      'example.com',
    );
    expect(referrerHost('javascript:alert(1)')).toBeNull();
    expect(referrerHost('not a url')).toBeNull();
    expect(referrerHost(undefined)).toBeNull();
    expect(referrerHost('')).toBeNull();
  });
});
