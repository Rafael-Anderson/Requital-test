import {
  attributionAdminView,
  hasMarketingConsent,
  parseAttribution,
  sanitizeAttribution,
  stripAttribution,
} from './attribution';

const FULL = {
  consent: { marketing: true },
  firstTouch: {
    source: 'Google',
    medium: 'CPC',
    campaign: 'Spring_Sale',
    gclid: 'g-first',
    referrer: 'https://www.google.com/search?q=secret&token=abc',
    landingPath: '/shop/products/rose?utm_source=google#frag',
    capturedAt: '2026-10-01T10:00:00.000Z',
  },
  lastTouch: { source: 'facebook', medium: 'paid_social', fbclid: 'fb-last' },
  fbp: 'fb.1.123.456',
  fbc: 'fb.1.123.abc',
  clientUserAgent: 'Mozilla/5.0 test',
};

describe('sanitizeAttribution', () => {
  it('returns null for anything that is not an object (stored as unknown)', () => {
    for (const bad of [undefined, null, 'x', 7, [], true]) {
      expect(sanitizeAttribution(bad)).toBeNull();
    }
  });

  it('keeps click ids, fbp/fbc and the user agent ONLY with explicit marketing consent', () => {
    const withConsent = sanitizeAttribution(FULL)!;
    expect(withConsent.firstTouch?.gclid).toBe('g-first');
    expect(withConsent.lastTouch?.fbclid).toBe('fb-last');
    expect(withConsent.fbp).toBe('fb.1.123.456');
    expect(withConsent.fbc).toBe('fb.1.123.abc');
    expect(withConsent.clientUserAgent).toBe('Mozilla/5.0 test');

    for (const marketing of [false, null, undefined, 'true', 1]) {
      const out = sanitizeAttribution({ ...FULL, consent: { marketing } })!;
      const text = JSON.stringify(out);
      expect(text).not.toContain('g-first');
      expect(text).not.toContain('fb-last');
      expect(text).not.toContain('fb.1.');
      expect(text).not.toContain('Mozilla');
      expect(out.consent.marketing).toBe(marketing === false ? false : null);
      // first-party campaign metadata is still kept
      expect(out.firstTouch?.source).toBe('google');
      expect(out.firstTouch?.campaign).toBe('Spring_Sale');
    }
  });

  it('records a missing consent object as unknown (null), never false-by-default or true', () => {
    expect(sanitizeAttribution({ firstTouch: { source: 'x' } })!.consent).toEqual({
      marketing: null,
    });
  });

  it('lower-cases source/medium, drops query strings and fragments, and bounds length', () => {
    const out = sanitizeAttribution(FULL)!;
    expect(out.firstTouch?.source).toBe('google');
    expect(out.firstTouch?.medium).toBe('cpc');
    expect(out.firstTouch?.referrer).toBe('https://www.google.com/search');
    expect(out.firstTouch?.landingPath).toBe('/shop/products/rose');
    const long = sanitizeAttribution({
      consent: { marketing: false },
      firstTouch: { source: 'a'.repeat(5000), campaign: 'c'.repeat(5000) },
    })!;
    expect(long.firstTouch?.source).toHaveLength(200);
    expect(long.firstTouch?.campaign).toHaveLength(200);
  });

  it('drops malformed fields instead of throwing', () => {
    const out = sanitizeAttribution({
      consent: { marketing: false },
      firstTouch: {
        source: { evil: true },
        referrer: 'javascript:alert(1)',
        landingPath: 'no-leading-slash',
        capturedAt: 'not a date',
        unknownKey: 'x',
      },
      lastTouch: 'nope',
    })!;
    expect(out.firstTouch).toBeUndefined();
    expect(out.lastTouch).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('unknownKey');
  });
});

describe('hasMarketingConsent', () => {
  it('is true only for an explicit recorded true', () => {
    expect(hasMarketingConsent({ consent: { marketing: true } })).toBe(true);
    expect(hasMarketingConsent(JSON.stringify({ consent: { marketing: true } }))).toBe(true);
    for (const v of [null, undefined, {}, { consent: {} }, { consent: { marketing: false } }, { consent: { marketing: null } }, { consent: { marketing: 'true' } }, 'garbage', []]) {
      expect(hasMarketingConsent(v)).toBe(false);
    }
  });
});

describe('attributionAdminView / stripAttribution / parseAttribution', () => {
  it('the staff view carries touches and consent but no click ids, fbp, fbc or user agent', () => {
    const view = attributionAdminView(sanitizeAttribution(FULL))!;
    const text = JSON.stringify(view);
    expect(text).not.toMatch(/gclid|fbclid|ttclid|fbp|fbc|Mozilla|g-first|fb-last/);
    expect(view.consentMarketing).toBe(true);
    expect(view.firstTouch?.source).toBe('google');
  });

  it('unknown stays unknown: null in, null out', () => {
    expect(attributionAdminView(null)).toBeNull();
    expect(parseAttribution('{bad json')).toBeNull();
  });

  it('stripAttribution removes the raw column and nothing else', () => {
    const row = { id: 1, total: '5', attributionJson: { fbp: 'x' } };
    expect(stripAttribution(row)).toEqual({ id: 1, total: '5' });
    expect(row.attributionJson).toBeDefined(); // original untouched
  });
});
