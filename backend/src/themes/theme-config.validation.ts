import { BadRequestException } from '@nestjs/common';
import { SECTION_TYPES } from './constants';
import type { ThemeConfig } from './theme-config.types';

// Safety cap, not the spec's 50KB *target* for a well-formed theme (which
// should be achievable naturally since sections store only primitives/URLs,
// never inline image data).
const MAX_CONFIG_BYTES = 200_000;
const SECTION_TYPE_SET = new Set<string>(SECTION_TYPES);

// Structural validator for the nested config JSON blob — same spirit as
// ThemeService.assertValidColors (theme/theme.service.ts) and
// BioLinksService.assertFieldsMatchType, but adapted for a nested
// array-of-objects rather than a flat map or single row.
//
// Deliberately shallow: only the top-level shape (sections[] entries having
// id/type/visible/order/settings, `type` being a known SectionType) is
// checked. `settings`'s own nested fields (typography/spacing/background/
// ...) are not exhaustively schema-checked, matching the same looseness
// themesettings.colors already has — a malformed nested field renders with
// a client-side fallback rather than 400ing the whole save.
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

  for (const key of ['globalSettings', 'header', 'footer'] as const) {
    if (c[key] !== undefined && (typeof c[key] !== 'object' || c[key] === null)) {
      throw new BadRequestException(`${key} must be an object`);
    }
  }

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
  });
}
