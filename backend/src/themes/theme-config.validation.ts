import { BadRequestException } from '@nestjs/common';
import { MAX_BLOCK_DEPTH, SECTION_TYPES } from './constants';
import type { ThemeConfig } from './theme-config.types';

// Safety cap, not the spec's 50KB *target* for a well-formed theme (which
// should be achievable naturally since sections store only primitives/URLs,
// never inline image data).
const MAX_CONFIG_BYTES = 200_000;
const SECTION_TYPE_SET = new Set<string>(SECTION_TYPES);

// Matches Shopify's own real theme-level Custom CSS limit (1500 chars) and
// restriction list (no @import/@charset/@namespace — Shopify's own
// documented reasons: these can load external resources or redefine the
// cascade root in ways a scoped style injection shouldn't allow). <script
// is an obvious defense-in-depth addition beyond what Shopify itself
// documents, since this is injected via a raw <style> tag, not Shopify's
// own asset pipeline. A substring/regex reject-list, not a full CSS parser
// — matches the explicit "basic sanity check is enough" instruction.
const CUSTOM_CSS_MAX_CHARS = 1500;
const CUSTOM_CSS_REJECT_PATTERNS: RegExp[] = [/<script/i, /@import/i, /@charset/i, /@namespace/i];

function assertValidBlock(block: unknown, path: string, depth: number): void {
  if (depth > MAX_BLOCK_DEPTH) {
    throw new BadRequestException(
      `${path} exceeds the maximum block nesting depth of ${MAX_BLOCK_DEPTH}`,
    );
  }
  if (typeof block !== 'object' || block === null) {
    throw new BadRequestException(`${path} must be an object`);
  }
  const b = block as Record<string, unknown>;
  if (typeof b.id !== 'string' || b.id.length === 0) {
    throw new BadRequestException(`${path}.id must be a non-empty string`);
  }
  if (typeof b.type !== 'string' || b.type.length === 0) {
    throw new BadRequestException(`${path}.type must be a non-empty string`);
  }
  if (typeof b.visible !== 'boolean') {
    throw new BadRequestException(`${path}.visible must be a boolean`);
  }
  if (typeof b.order !== 'number') {
    throw new BadRequestException(`${path}.order must be a number`);
  }
  if (typeof b.settings !== 'object' || b.settings === null) {
    throw new BadRequestException(`${path}.settings must be an object`);
  }
  if (b.blocks !== undefined) {
    if (!Array.isArray(b.blocks)) {
      throw new BadRequestException(`${path}.blocks must be an array`);
    }
    b.blocks.forEach((child, i) => assertValidBlock(child, `${path}.blocks[${i}]`, depth + 1));
  }
}

// Shared by header/footer — same {settings, blocks[]} shape as a section,
// just not itself a section-type/visible/order-bearing node.
function assertValidBlockContainer(container: unknown, path: string): void {
  if (typeof container !== 'object' || container === null) {
    throw new BadRequestException(`${path} must be an object`);
  }
  const c = container as Record<string, unknown>;
  if (c.settings !== undefined && (typeof c.settings !== 'object' || c.settings === null)) {
    throw new BadRequestException(`${path}.settings must be an object`);
  }
  if (c.blocks === undefined) return;
  if (!Array.isArray(c.blocks)) {
    throw new BadRequestException(`${path}.blocks must be an array`);
  }
  c.blocks.forEach((block, i) => assertValidBlock(block, `${path}.blocks[${i}]`, 1));
}

function assertValidCustomCss(customCss: unknown): void {
  if (typeof customCss !== 'object' || customCss === null) {
    throw new BadRequestException('globalSettings.customCss must be an object');
  }
  const cc = customCss as Record<string, unknown>;
  if (cc.css === undefined) return;
  if (typeof cc.css !== 'string') {
    throw new BadRequestException('globalSettings.customCss.css must be a string');
  }
  if (cc.css.length > CUSTOM_CSS_MAX_CHARS) {
    throw new BadRequestException(
      `globalSettings.customCss.css exceeds the ${CUSTOM_CSS_MAX_CHARS} character limit`,
    );
  }
  for (const pattern of CUSTOM_CSS_REJECT_PATTERNS) {
    if (pattern.test(cc.css)) {
      throw new BadRequestException(
        `globalSettings.customCss.css contains a disallowed pattern: ${pattern.source}`,
      );
    }
  }
}

// Structural validator for the nested config JSON blob — same spirit as
// ThemeService.assertValidColors (theme/theme.service.ts) and
// BioLinksService.assertFieldsMatchType, extended to a real recursive tree
// (section -> block -> sub-block, depth-capped) rather than PR #31's one
// flat elements[] level.
//
// Deliberately shallow beyond structure: `settings`'s own nested fields
// (typography/spacing/background/...) are not exhaustively schema-checked,
// matching the same looseness themesettings.colors already has — a
// malformed nested field renders with a client-side fallback rather than
// 400ing the whole save. Custom CSS is the one exception (real length/
// content restrictions), since it's injected as real CSS on the live
// storefront, not just consumed as opaque settings data.
export function assertValidThemeConfig(config: unknown): asserts config is ThemeConfig {
  if (Buffer.byteLength(JSON.stringify(config)) > MAX_CONFIG_BYTES) {
    throw new BadRequestException(
      `Theme config exceeds the ${MAX_CONFIG_BYTES} byte safety limit`,
    );
  }
  if (typeof config !== 'object' || config === null) {
    throw new BadRequestException('config must be an object');
  }

  const c = config as Record<string, unknown>;
  const allowedKeys = new Set(['globalSettings', 'header', 'footer', 'sections']);
  for (const key of Object.keys(c)) {
    if (!allowedKeys.has(key)) {
      throw new BadRequestException(`Unknown theme config key: '${key}'`);
    }
  }

  if (c.globalSettings !== undefined) {
    if (typeof c.globalSettings !== 'object' || c.globalSettings === null) {
      throw new BadRequestException('globalSettings must be an object');
    }
    const g = c.globalSettings as Record<string, unknown>;
    if (g.colorSchemes !== undefined) {
      if (!Array.isArray(g.colorSchemes)) {
        throw new BadRequestException('globalSettings.colorSchemes must be an array');
      }
      g.colorSchemes.forEach((scheme, i) => {
        if (typeof scheme !== 'object' || scheme === null) {
          throw new BadRequestException(`globalSettings.colorSchemes[${i}] must be an object`);
        }
        const s = scheme as Record<string, unknown>;
        if (typeof s.id !== 'string' || s.id.length === 0) {
          throw new BadRequestException(`globalSettings.colorSchemes[${i}].id must be a non-empty string`);
        }
      });
    }
    if (g.customCss !== undefined) {
      assertValidCustomCss(g.customCss);
    }
  }

  if (c.header !== undefined) assertValidBlockContainer(c.header, 'header');
  if (c.footer !== undefined) assertValidBlockContainer(c.footer, 'footer');

  if (c.sections === undefined) return;
  if (!Array.isArray(c.sections)) {
    throw new BadRequestException('sections must be an array');
  }

  c.sections.forEach((section, index) => {
    if (typeof section !== 'object' || section === null) {
      throw new BadRequestException(`sections[${index}] must be an object`);
    }
    const s = section as Record<string, unknown>;
    if (typeof s.id !== 'string' || s.id.length === 0) {
      throw new BadRequestException(`sections[${index}].id must be a non-empty string`);
    }
    if (typeof s.type !== 'string' || !SECTION_TYPE_SET.has(s.type)) {
      throw new BadRequestException(
        `sections[${index}].type must be one of: ${SECTION_TYPES.join(', ')}`,
      );
    }
    if (typeof s.visible !== 'boolean') {
      throw new BadRequestException(`sections[${index}].visible must be a boolean`);
    }
    if (typeof s.order !== 'number') {
      throw new BadRequestException(`sections[${index}].order must be a number`);
    }
    if (typeof s.settings !== 'object' || s.settings === null) {
      throw new BadRequestException(`sections[${index}].settings must be an object`);
    }
    if (s.blocks !== undefined) {
      if (!Array.isArray(s.blocks)) {
        throw new BadRequestException(`sections[${index}].blocks must be an array`);
      }
      s.blocks.forEach((block, i) => assertValidBlock(block, `sections[${index}].blocks[${i}]`, 1));
    }
  });
}
