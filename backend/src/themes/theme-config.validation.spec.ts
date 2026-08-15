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
  });
});
