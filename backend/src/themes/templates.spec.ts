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

  it('leaves animations.addToCart / pageTransition off (deliberate — re-author when the consumer lands)', () => {
    expect(template.globalSettings.animations.addToCart).toBe(false);
    expect(template.globalSettings.animations.pageTransition).toBe(false);
  });

  it('only sets a currently-valid cardHoverEffect value', () => {
    expect(['none', 'zoom', 'rise', 'swap', 'desaturate', 'quick-add-slide', 'overlay', 'shadow', 'tilt']).toContain(
      template.globalSettings.animations.cardHoverEffect,
    );
  });
});
