import { BadRequestException } from '@nestjs/common';
import { assertValidThemeConfig } from './theme-config.validation';
import { DEFAULT_THEME_CONFIG, MAX_BLOCK_DEPTH } from './constants';

function baseConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_THEME_CONFIG));
}

describe('assertValidThemeConfig', () => {
  it('accepts the real DEFAULT_THEME_CONFIG unchanged', () => {
    expect(() => assertValidThemeConfig(baseConfig())).not.toThrow();
  });

  it('rejects an unknown top-level key', () => {
    const config = { ...baseConfig(), notARealKey: true };
    expect(() => assertValidThemeConfig(config)).toThrow(BadRequestException);
  });

  describe('recursive block validation', () => {
    it('accepts a nested sub-block (section -> block -> sub-block)', () => {
      const config = baseConfig();
      config.sections[2].blocks[0].blocks.push({
        id: 'blk-extra',
        type: 'view_all_button',
        visible: true,
        order: 2,
        settings: {},
      });
      expect(() => assertValidThemeConfig(config)).not.toThrow();
    });

    it('rejects a block missing a required field', () => {
      const config = baseConfig();
      delete config.sections[1].blocks[0].visible;
      expect(() => assertValidThemeConfig(config)).toThrow(BadRequestException);
    });

    it('rejects nesting deeper than MAX_BLOCK_DEPTH', () => {
      const config = baseConfig();
      // Build a chain of blocks nested one level past the cap.
      let deepest: Record<string, unknown> = {
        id: 'blk-leaf',
        type: 'text',
        visible: true,
        order: 0,
        settings: {},
      };
      for (let i = 0; i < MAX_BLOCK_DEPTH + 1; i++) {
        deepest = {
          id: `blk-wrap-${i}`,
          type: 'text',
          visible: true,
          order: 0,
          settings: {},
          blocks: [deepest],
        };
      }
      config.sections[1].blocks = [deepest];
      expect(() => assertValidThemeConfig(config)).toThrow(BadRequestException);
    });
  });

  describe('section types', () => {
    it('accepts a brands section (settings-only, no blocks)', () => {
      const config = baseConfig();
      config.sections.push({
        id: 'sec-brands',
        type: 'brands',
        visible: true,
        order: config.sections.length,
        settings: { heading: 'Shop by brand', logosPerRow: 5, brandIds: [] },
        blocks: [],
      });
      expect(() => assertValidThemeConfig(config)).not.toThrow();
    });

    it('rejects an unknown section type', () => {
      const config = baseConfig();
      config.sections.push({
        id: 'sec-bogus',
        type: 'not_a_real_section',
        visible: true,
        order: config.sections.length,
        settings: {},
        blocks: [],
      });
      expect(() => assertValidThemeConfig(config)).toThrow(BadRequestException);
    });

    it('accepts a product_tabs section (settings-only, no blocks)', () => {
      const config = baseConfig();
      config.sections.push({
        id: 'sec-product-tabs',
        type: 'product_tabs',
        visible: true,
        order: config.sections.length,
        settings: {
          columns: 4,
          productLimit: 8,
          tabs: [
            { id: 'tab-1', label: 'Best Selling', collectionId: 3 },
            { id: 'tab-2', label: 'Seasonal', collectionId: 7 },
          ],
        },
        blocks: [],
      });
      expect(() => assertValidThemeConfig(config)).not.toThrow();
    });

    it('does NOT 400 a product_tabs section with a malformed tabs array — settings are shallow beyond structure', () => {
      const config = baseConfig();
      config.sections.push({
        id: 'sec-product-tabs-bad',
        type: 'product_tabs',
        visible: true,
        order: config.sections.length,
        settings: {
          // Every one of these is wrong (missing fields, wrong types, not
          // even an object) — the storefront's resolveProductTabs drops them
          // and renders nothing; the validator must not reject the save.
          tabs: [{ label: 'no id' }, { id: 5, collectionId: 'x' }, 'garbage', null],
        },
        blocks: [],
      });
      expect(() => assertValidThemeConfig(config)).not.toThrow();
    });
  });

  describe('header rows + utility blocks (Phase 3)', () => {
    it('accepts the new header utility block types and a header.settings.rows blob', () => {
      const config = baseConfig();
      config.header.settings.rows = [
        { id: 'row-1', blockIds: ['hdr-contact', 'hdr-social'], align: 'between', background: '#101010' },
        { id: 'row-2', blockIds: ['hdr-logo'], align: 'center' },
      ];
      config.header.blocks.push(
        { id: 'hdr-contact', type: 'contact_bar_item', visible: true, order: 5, settings: { kind: 'phone', value: '+97140000000' } },
        { id: 'hdr-social', type: 'social_row', visible: true, order: 6, settings: { links: [{ platform: 'instagram', url: 'https://x' }] } },
        { id: 'hdr-lang', type: 'language_switcher', visible: true, order: 7, settings: {} },
      );
      expect(() => assertValidThemeConfig(config)).not.toThrow();
    });

    it('does NOT 400 a malformed header.settings.rows — settings are shallow beyond structure', () => {
      const config = baseConfig();
      config.header.settings.rows = [null, 'x', { blockIds: 'not-an-array' }, { id: 5 }];
      expect(() => assertValidThemeConfig(config)).not.toThrow();
    });
  });

  describe('color schemes', () => {
    it('rejects a color scheme with no id', () => {
      const config = baseConfig();
      config.globalSettings.colorSchemes.push({ name: 'Bad scheme' });
      expect(() => assertValidThemeConfig(config)).toThrow(BadRequestException);
    });
  });

  describe('custom CSS', () => {
    it('accepts empty custom CSS', () => {
      const config = baseConfig();
      config.globalSettings.customCss = { css: '' };
      expect(() => assertValidThemeConfig(config)).not.toThrow();
    });

    it('accepts real, benign CSS under the length cap', () => {
      const config = baseConfig();
      config.globalSettings.customCss = { css: '.card { border-radius: 30px; }' };
      expect(() => assertValidThemeConfig(config)).not.toThrow();
    });

    it('rejects CSS over the 1500 character cap', () => {
      const config = baseConfig();
      config.globalSettings.customCss = { css: 'a'.repeat(1501) };
      expect(() => assertValidThemeConfig(config)).toThrow(BadRequestException);
    });

    it.each(['<script>alert(1)</script>', '@import url(evil.css);', '@charset "UTF-8";', '@namespace svg url(x);'])(
      'rejects disallowed pattern: %s',
      (css) => {
        const config = baseConfig();
        config.globalSettings.customCss = { css };
        expect(() => assertValidThemeConfig(config)).toThrow(BadRequestException);
      },
    );

    // Security-audit finding: the reject-list above used to run against the
    // raw string, so any of these got through — a real browser still
    // decodes/executes every one of them. Each case is rejected only once
    // the input is normalized (unicode-escape decoded / comments stripped)
    // before the same pattern list runs.
    describe('bypasses of the reject-list via CSS-level obfuscation', () => {
      it.each([
        // Numeric hex escape — \69 is U+0069 'i'.
        '@\\69mport url(evil.css);',
        // Literal-character escape — 'i' isn't a hex digit, so CSS treats
        // \i as just an escaped literal 'i'. An even simpler bypass of a
        // naive /@import/i check than the hex form.
        '@\\import url(evil.css);',
        // Escapes scattered across the whole keyword, not just the first
        // character, to make sure decoding isn't accidentally anchored to
        // one position.
        '@\\69\\6d\\70ort url(evil.css);',
      ])('rejects @import obfuscated via CSS escapes: %s', (css) => {
        const config = baseConfig();
        config.globalSettings.customCss = { css };
        expect(() => assertValidThemeConfig(config)).toThrow(BadRequestException);
      });

      it('a CSS comment inside otherwise-benign CSS is not itself treated as an obfuscation attempt', () => {
        // Real browsers do NOT parse this as @import either — a comment
        // ends an in-progress identifier token — but the point of this case
        // is that stripping the comment must not glue two unrelated halves
        // together into a false positive (or, symmetrically, leave a real
        // comment-splitting attempt unnormalized into a false negative).
        const config = baseConfig();
        config.globalSettings.customCss = { css: '.a/*comment*/{color:red}' };
        expect(() => assertValidThemeConfig(config)).not.toThrow();
      });
    });

    it.each([
      ['background: url(javascript:alert(1));', 'url(javascript:...)'],
      ["background: url('javascript:alert(1)');", 'url(javascript:...) with quotes'],
      ['width: expression(alert(1));', 'expression()'],
      ['behavior: url(evil.htc);', 'behavior:'],
      ['-moz-binding: url(evil.xml#xss);', '-moz-binding'],
    ])('rejects the newly-added pattern: %s (%s)', (css) => {
      const config = baseConfig();
      config.globalSettings.customCss = { css };
      expect(() => assertValidThemeConfig(config)).toThrow(BadRequestException);
    });
  });
});
