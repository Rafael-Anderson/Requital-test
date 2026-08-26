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
