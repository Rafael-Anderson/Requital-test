import { BadRequestException } from '@nestjs/common';
import { ThemesService, backfillGlobalSettings, cloneConfigWithFreshIds } from './themes.service';
import { DEFAULT_THEME_CONFIG } from './constants';
import { THEME_TEMPLATES } from './templates';
import type { ThemeConfig } from './theme-config.types';
import type { TenantContext } from '../common/tenant-context';

// cloneConfigWithFreshIds is a pure function (source ThemeConfig -> new
// ThemeConfig with every id regenerated) — tested directly rather than
// through ThemesService.create()'s DB-backed path, matching this codebase's
// convention of testing pure logic in isolation.
describe('cloneConfigWithFreshIds', () => {
  it('gives every section, block, and sub-block a fresh id', () => {
    const clone = cloneConfigWithFreshIds(DEFAULT_THEME_CONFIG);

    clone.sections.forEach((section, i) => {
      expect(section.id).not.toBe(DEFAULT_THEME_CONFIG.sections[i].id);
      section.blocks.forEach((block, j) => {
        expect(block.id).not.toBe(DEFAULT_THEME_CONFIG.sections[i].blocks[j].id);
        block.blocks?.forEach((subBlock, k) => {
          expect(subBlock.id).not.toBe(DEFAULT_THEME_CONFIG.sections[i].blocks[j].blocks?.[k].id);
        });
      });
    });

    clone.header.blocks.forEach((block, i) => {
      expect(block.id).not.toBe(DEFAULT_THEME_CONFIG.header.blocks[i].id);
    });
  });

  it('gives every color scheme a fresh id', () => {
    const clone = cloneConfigWithFreshIds(DEFAULT_THEME_CONFIG);
    clone.globalSettings.colorSchemes.forEach((scheme, i) => {
      expect(scheme.id).not.toBe(DEFAULT_THEME_CONFIG.globalSettings.colorSchemes[i].id);
    });
  });

  // The real correctness case: a naive "regenerate every scheme id
  // independently" pass would silently break any reference to that scheme
  // (badges/drawers/popovers/section.settings.schemeId) — this asserts
  // every reference in the clone points at the CLONE's own scheme, never
  // the source theme's original scheme id.
  it('remaps every scheme reference (badges, drawers, popovers, section settings) to the cloned scheme ids, not the originals', () => {
    const customSchemeId = 'scheme-custom';
    const source: ThemeConfig = {
      ...DEFAULT_THEME_CONFIG,
      globalSettings: {
        ...DEFAULT_THEME_CONFIG.globalSettings,
        colorSchemes: [
          ...DEFAULT_THEME_CONFIG.globalSettings.colorSchemes,
          {
            id: customSchemeId,
            name: 'Custom scheme',
            background: '#000000',
            text: '#ffffff',
            button: '#ff0000',
            buttonLabel: '#ffffff',
            secondaryButtonLabel: '#ff0000',
          },
        ],
        badges: {
          ...DEFAULT_THEME_CONFIG.globalSettings.badges,
          saleSchemeId: customSchemeId,
          soldOutSchemeId: customSchemeId,
        },
        drawers: { ...DEFAULT_THEME_CONFIG.globalSettings.drawers, schemeId: customSchemeId },
        popovers: { ...DEFAULT_THEME_CONFIG.globalSettings.popovers, schemeId: customSchemeId },
      },
      sections: [
        {
          ...DEFAULT_THEME_CONFIG.sections[0],
          settings: { ...DEFAULT_THEME_CONFIG.sections[0].settings, schemeId: customSchemeId },
        },
        ...DEFAULT_THEME_CONFIG.sections.slice(1),
      ],
    };

    const clone = cloneConfigWithFreshIds(source);
    const clonedCustomScheme = clone.globalSettings.colorSchemes.find((s) => s.name === 'Custom scheme');

    expect(clonedCustomScheme).toBeDefined();
    expect(clonedCustomScheme!.id).not.toBe(customSchemeId);

    // Every reference in the clone points at the clone's own scheme id...
    expect(clone.globalSettings.badges.saleSchemeId).toBe(clonedCustomScheme!.id);
    expect(clone.globalSettings.badges.soldOutSchemeId).toBe(clonedCustomScheme!.id);
    expect(clone.globalSettings.drawers.schemeId).toBe(clonedCustomScheme!.id);
    expect(clone.globalSettings.popovers.schemeId).toBe(clonedCustomScheme!.id);
    expect(clone.sections[0].settings.schemeId).toBe(clonedCustomScheme!.id);

    // ...and never the original source theme's scheme id.
    expect(clone.globalSettings.badges.saleSchemeId).not.toBe(customSchemeId);
    expect(clone.sections[0].settings.schemeId).not.toBe(customSchemeId);
  });

  it('leaves the source config completely untouched (no shared references)', () => {
    const originalJson = JSON.stringify(DEFAULT_THEME_CONFIG);
    cloneConfigWithFreshIds(DEFAULT_THEME_CONFIG);
    expect(JSON.stringify(DEFAULT_THEME_CONFIG)).toBe(originalJson);
  });

  // C1 real bug, found via the scratch-shop Playwright pass: cloneBlock
  // gives every header block a fresh id, but a row's blockIds kept
  // referencing the SOURCE theme's ids — resolveHeaderRows found no match
  // for any of them, and its "leftover" fallback dumped every block into
  // the last row, silently collapsing a multi-row header into one row on
  // every clone (fromTemplate creation and duplicateFromId both go through
  // this function). Confirmed for real against Market/Heritage's own
  // header.settings.rows (see templates.ts).
  it('remaps header.settings.rows[].blockIds to the cloned block ids, not the originals', () => {
    const source: ThemeConfig = {
      ...DEFAULT_THEME_CONFIG,
      header: {
        settings: { rows: [{ id: 'row-1', blockIds: ['hdr-logo', 'hdr-nav-menu'], align: 'left' }] },
        blocks: DEFAULT_THEME_CONFIG.header.blocks,
      },
    };

    const clone = cloneConfigWithFreshIds(source);
    const clonedLogo = clone.header.blocks.find((b) => b.type === 'logo')!;
    const clonedNav = clone.header.blocks.find((b) => b.type === 'nav_menu')!;
    const rows = clone.header.settings.rows as { blockIds: string[] }[];

    expect(rows[0].blockIds).toEqual([clonedLogo.id, clonedNav.id]);
    expect(rows[0].blockIds).not.toContain('hdr-logo');
    expect(rows[0].blockIds).not.toContain('hdr-nav-menu');
  });

  it('leaves header.settings untouched when rows is absent (no-op case)', () => {
    const clone = cloneConfigWithFreshIds(DEFAULT_THEME_CONFIG);
    expect(clone.header.settings).toEqual(DEFAULT_THEME_CONFIG.header.settings);
  });
});

// Regression coverage for the QA-audit ColorPicker crash: a theme row
// created before a field was added to GlobalThemeSettings must still
// backfill to that field's default on every read, at any nesting depth —
// not just for collectionPage (the one category the original, narrower fix
// special-cased) but for any category, since the same class of gap was
// separately confirmed for productCards.
describe('backfillGlobalSettings', () => {
  it('backfills a whole missing category (the originally-confirmed collectionPage crash)', () => {
    const stale = JSON.parse(JSON.stringify(DEFAULT_THEME_CONFIG)) as ThemeConfig;
    delete (stale.globalSettings as Partial<ThemeConfig['globalSettings']>).collectionPage;

    const result = backfillGlobalSettings(stale);

    expect(result.globalSettings.collectionPage).toEqual(
      DEFAULT_THEME_CONFIG.globalSettings.collectionPage,
    );
  });

  it('backfills one missing field on an otherwise-present category, not just a whole missing category (the ColorPicker crash: productCards existed but was missing its 3 newer color fields)', () => {
    const stale = JSON.parse(JSON.stringify(DEFAULT_THEME_CONFIG)) as ThemeConfig;
    const staleProductCards = stale.globalSettings.productCards as unknown as Record<string, unknown>;
    delete staleProductCards.quickAddBackground;
    delete staleProductCards.quickAddText;
    delete staleProductCards.productNameColor;
    // A field the stale row DID have should survive untouched, not be
    // silently overwritten by the default.
    staleProductCards.quickAdd = false;

    const result = backfillGlobalSettings(stale);

    expect(result.globalSettings.productCards.quickAddBackground).toBe(
      DEFAULT_THEME_CONFIG.globalSettings.productCards.quickAddBackground,
    );
    expect(result.globalSettings.productCards.quickAddText).toBe(
      DEFAULT_THEME_CONFIG.globalSettings.productCards.quickAddText,
    );
    expect(result.globalSettings.productCards.productNameColor).toBe(
      DEFAULT_THEME_CONFIG.globalSettings.productCards.productNameColor,
    );
    expect(result.globalSettings.productCards.quickAdd).toBe(false);
  });

  it('replaces colorSchemes wholesale rather than merging array elements', () => {
    const stale = JSON.parse(JSON.stringify(DEFAULT_THEME_CONFIG)) as ThemeConfig;
    const customScheme = { ...stale.globalSettings.colorSchemes[0], id: 'scheme-custom' };
    stale.globalSettings.colorSchemes = [customScheme];

    const result = backfillGlobalSettings(stale);

    expect(result.globalSettings.colorSchemes).toEqual([customScheme]);
    expect(result.globalSettings.colorSchemes).not.toEqual(
      DEFAULT_THEME_CONFIG.globalSettings.colorSchemes,
    );
  });

  it('is a no-op for an already-complete config', () => {
    const result = backfillGlobalSettings(
      JSON.parse(JSON.stringify(DEFAULT_THEME_CONFIG)) as ThemeConfig,
    );
    expect(result.globalSettings).toEqual(DEFAULT_THEME_CONFIG.globalSettings);
  });
});

// Phase G0 — the fromTemplate branch of ThemesService.create. Mocked DB, same
// isolation convention as above.
describe('ThemesService.create — fromTemplate (Flow A)', () => {
  const ctx = { shopId: 7, userId: 1, role: 'admin', outletId: null } as TenantContext;

  function makeService(captured: { config?: ThemeConfig }) {
    const db = {
      execute: jest.fn().mockResolvedValue({ insertId: 99 }),
      query: jest.fn().mockImplementation((_sql: string, params: unknown[]) => {
        // getOwnedTheme(result.insertId) — return the row we just "inserted".
        return Promise.resolve([{ id: params[0], shopId: 7, name: 'x', isPublished: 0, config: captured.config }]);
      }),
    };
    return new ThemesService(
      db as never,
      { invalidate: jest.fn() } as never,
      {} as never,
    );
  }

  it('builds the new theme from the named template with fresh ids', async () => {
    const captured: { config?: ThemeConfig } = {};
    const db = {
      execute: jest.fn().mockImplementation((_sql: string, params: unknown[]) => {
        captured.config = JSON.parse(params[2] as string) as ThemeConfig;
        return Promise.resolve({ insertId: 99 });
      }),
      query: jest.fn().mockResolvedValue([{ id: 99, shopId: 7, name: 'x', isPublished: 0, config: captured.config ?? DEFAULT_THEME_CONFIG }]),
    };
    const service = new ThemesService(db as never, { invalidate: jest.fn() } as never, {} as never);

    await service.create(ctx, { name: 'Heritage', fromTemplate: 'heritage' });

    expect(captured.config).toBeDefined();
    expect(captured.config!.globalSettings.colorSchemes[0].background).toBe(
      THEME_TEMPLATES.heritage.globalSettings.colorSchemes[0].background,
    );
    // fresh ids, not the template literal's
    expect(captured.config!.sections[0].id).not.toBe(THEME_TEMPLATES.heritage.sections[0].id);
    expect(captured.config!.globalSettings.colorSchemes[0].id).not.toBe(
      THEME_TEMPLATES.heritage.globalSettings.colorSchemes[0].id,
    );
  });

  it('rejects duplicateFromId + fromTemplate together', async () => {
    const service = makeService({});
    await expect(
      service.create(ctx, { name: 'x', duplicateFromId: 1, fromTemplate: 'atelier' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('listTemplates returns preview metadata for all four', () => {
    const service = makeService({});
    const metas = service.listTemplates();
    expect(metas.map((m) => m.key).sort()).toEqual(['atelier', 'bloom', 'heritage', 'market']);
    for (const m of metas) {
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.previewColors.button).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
