import { cloneConfigWithFreshIds } from './themes.service';
import { SECTION_TYPES } from './constants';
import { TEMPLATE_KEYS, TEMPLATE_META, THEME_TEMPLATES } from './templates';

// Phase G0 — the four starter templates. `tsc` already enforces each is a
// full, correctly-typed ThemeConfig (the primary drift guard); this covers the
// runtime invariants the create() path relies on. Structural validity against
// `assertValidThemeConfig` is asserted per-template in
// theme-config.validation.spec.ts.

const MAX_CONFIG_BYTES = 200_000;
const SECTION_TYPE_SET = new Set<string>(SECTION_TYPES);

function collectBlockIds(blocks: { id: string; blocks?: unknown[] }[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    out.push(b.id);
    if (Array.isArray(b.blocks)) out.push(...collectBlockIds(b.blocks as { id: string; blocks?: unknown[] }[]));
  }
  return out;
}

describe.each(TEMPLATE_KEYS)('THEME_TEMPLATES.%s', (key) => {
  const template = THEME_TEMPLATES[key];

  it('has matching TEMPLATE_META', () => {
    expect(TEMPLATE_META[key].key).toBe(key);
    expect(TEMPLATE_META[key].name.length).toBeGreaterThan(0);
    expect(TEMPLATE_META[key].blurb.length).toBeGreaterThan(0);
  });

  // Real reviews only: a template must never ship an invented testimonial,
  // rating, review count or "trusted by" claim. The testimonials section
  // carries just its heading; a merchant's real numbers are theirs to add.
  it('ships no fabricated social proof', () => {
    const all = JSON.stringify(template);
    expect(all).not.toMatch(/"type":"testimonial"/);
    expect(all).not.toMatch(/"type":"rating_badge"/);
    expect(all).not.toMatch(
      /Arrived exactly on time|gift box is gorgeous|So easy to personali|Reem A\.|Daniel K\.|Priya S\./,
    );
    expect(all).not.toMatch(
      /Trusted by|\d[\d,]*\+? reviews|Rated \d|5-star|since \d{4}|Established \d{4}|four decades/i,
    );
  });

  // No promise with nothing behind it: a template is starter copy a merchant
  // may publish unchanged, so it must not carry an offer, a free-* promise, a
  // guarantee, a delivery-speed or coverage claim, or urgency/scarcity text.
  // Those are the merchant's to write, against their own settings.
  it('ships no offer, guarantee, delivery-speed or urgency promise', () => {
    const texts: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') texts.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(template);
    const promise =
      /\d+\s*%\s*off|%\s*off|\boff your\b|first order|free (shipping|delivery|gift|wrap|returns?)|guarantee|money.?back|same.?day|next.?day|delivered (today|tomorrow)|within \d+|nationwide|across the country|early access|limited (time|stock|offer)|only \d+ left|selling fast|hurry|don'?t miss|best sellers?|\boffers?\b|\bsale\b ends|countdown/i;
    for (const t of texts) expect(t).not.toMatch(promise);
  });

  it('stays well under the 200KB config safety cap', () => {
    expect(Buffer.byteLength(JSON.stringify(template))).toBeLessThan(MAX_CONFIG_BYTES);
  });

  it('has at least one colour scheme, and every section is a known type', () => {
    expect(template.globalSettings.colorSchemes.length).toBeGreaterThanOrEqual(1);
    for (const s of template.sections) {
      expect(SECTION_TYPE_SET.has(s.type)).toBe(true);
    }
  });

  it('every section/block/scheme id is unique within the template', () => {
    const ids = [
      ...template.globalSettings.colorSchemes.map((s) => s.id),
      ...template.sections.flatMap((s) => [s.id, ...collectBlockIds(s.blocks)]),
      ...collectBlockIds(template.header.blocks),
      ...collectBlockIds(template.footer.blocks),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every section.settings.schemeId / badges / drawers / popovers reference resolves to a real scheme', () => {
    const schemeIds = new Set(template.globalSettings.colorSchemes.map((s) => s.id));
    const refs = [
      template.globalSettings.badges.saleSchemeId,
      template.globalSettings.badges.soldOutSchemeId,
      template.globalSettings.drawers.schemeId,
      template.globalSettings.popovers.schemeId,
      ...template.sections.map((s) => s.settings.schemeId).filter((v): v is string => typeof v === 'string'),
    ];
    for (const ref of refs) {
      if (ref !== undefined) expect(schemeIds.has(ref)).toBe(true);
    }
  });

  it('cloneConfigWithFreshIds does not throw and regenerates every id + remaps scheme refs', () => {
    const clone = cloneConfigWithFreshIds(template);

    // section / block / sub-block ids all fresh
    clone.sections.forEach((section, i) => {
      expect(section.id).not.toBe(template.sections[i].id);
      section.blocks.forEach((b, j) => {
        expect(b.id).not.toBe(template.sections[i].blocks[j].id);
      });
    });
    // scheme ids fresh
    clone.globalSettings.colorSchemes.forEach((s, i) => {
      expect(s.id).not.toBe(template.globalSettings.colorSchemes[i].id);
    });
    // references point at the clone's own schemes, never the template's
    const cloneSchemeIds = new Set(clone.globalSettings.colorSchemes.map((s) => s.id));
    expect(cloneSchemeIds.has(clone.globalSettings.badges.saleSchemeId)).toBe(true);
    for (const s of clone.sections) {
      if (typeof s.settings.schemeId === 'string') {
        expect(cloneSchemeIds.has(s.settings.schemeId)).toBe(true);
      }
    }
  });

  // C1 real bug, found via the scratch-shop Playwright pass: a template's
  // header.settings.rows[].blockIds referenced the SOURCE template's block
  // ids, which cloneConfigWithFreshIds regenerates — every id resolved to
  // nothing, silently collapsing Market's/Heritage's multi-row header into
  // one row on every real fromTemplate creation. Fixed in
  // cloneConfigWithFreshIds itself (themes.service.ts); this asserts the
  // fix holds for every template that actually uses rows (a template with
  // no rows has nothing to check, hence the guard).
  it("cloneConfigWithFreshIds remaps header.settings.rows[].blockIds to real cloned block ids (if this template uses rows)", () => {
    const clone = cloneConfigWithFreshIds(template);
    const rows = clone.header.settings.rows as { blockIds: string[] }[] | undefined;
    if (!rows) return;
    const cloneBlockIds = new Set(clone.header.blocks.map((b) => b.id));
    for (const row of rows) {
      for (const blockId of row.blockIds) {
        expect(cloneBlockIds.has(blockId)).toBe(true);
      }
    }
  });

  it('leaves animations.pageTransition off (no template wants route-content fade)', () => {
    expect(template.globalSettings.animations.pageTransition).toBe(false);
  });

  it('only opts into fly-to-cart on Market (§8.13.C item 16); the rest keep addToCart off', () => {
    if (key === 'market') {
      expect(template.globalSettings.animations.addToCart).toBe(true);
      expect(template.globalSettings.animations.addToCartStyle).toBe('fly');
    } else {
      expect(template.globalSettings.animations.addToCart).toBe(false);
      expect(template.globalSettings.animations.addToCartStyle).toBeUndefined();
    }
  });

  it('only sets a currently-valid cardHoverEffect value', () => {
    expect(['none', 'zoom', 'rise', 'swap', 'desaturate', 'quick-add-slide', 'overlay', 'shadow', 'tilt']).toContain(
      template.globalSettings.animations.cardHoverEffect,
    );
  });
});
