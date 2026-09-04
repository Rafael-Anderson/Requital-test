import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { buildSetClause } from '../database/update.util';
import { upsert } from '../database/upsert.util';
import type { TenantContext } from '../common/tenant-context';
import type { ThemeRow } from '../db/types';
import { CreateThemeDto } from './dto/create-theme.dto';
import { UpdateThemeDraftDto } from './dto/update-theme-draft.dto';
import { DEFAULT_THEME_CONFIG } from './constants';
import { TEMPLATE_KEYS, TEMPLATE_META, THEME_TEMPLATES, isTemplateKey } from './templates';
import { assertValidThemeConfig } from './theme-config.validation';
import { ThemeConfigCache } from './theme-config-cache';
import type {
  ColorScheme,
  GlobalThemeSettings,
  ThemeBlock,
  ThemeConfig,
  ThemeSection,
} from './theme-config.types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Generic deep-merge of `override` onto `defaults`, recursing into plain
// objects at any depth so a missing field is backfilled from its default
// regardless of how deeply nested it is. Arrays and any other non-plain-
// object value are treated as leaves and replaced wholesale by the
// override's own value when present, never merged element-by-element —
// deep-merging an array (colorSchemes) would silently combine an old
// theme's own scheme list with the defaults' one instead of just using it.
function deepMergeDefaults<T>(defaults: T, override: T | undefined): T {
  if (!isPlainObject(defaults) || !isPlainObject(override)) {
    return override !== undefined ? override : defaults;
  }
  const merged: Record<string, unknown> = { ...defaults };
  for (const key of Object.keys(override)) {
    merged[key] = deepMergeDefaults(
      (defaults as Record<string, unknown>)[key],
      (override as Record<string, unknown>)[key],
    );
  }
  return merged as T;
}

// Bug 6 QA-sweep fix: GlobalThemeSettings has grown by 18 categories over
// several phases (see constants.ts's own history), each added by editing
// DEFAULT_THEME_CONFIG going forward - nothing ever backfilled that new
// category (or a new field inside an existing category) into theme rows
// that already existed in the database at the time. Confirmed for real,
// not assumed, twice: theme id 1's own stored config (this repo's long-
// lived local dev/e2e theme) had no globalSettings.collectionPage key at
// all (crashed CollectionPageSettings.tsx and the storefront collection
// page outright), and separately had a productCards object missing its
// three newer color fields (crashed ColorPicker.tsx's normalizeHex on an
// undefined value — see that component's own comment). The first fix here
// only special-cased collectionPage, deliberately, since deep-merging every
// category untested risked masking a shape it didn't actually handle
// correctly; the second crash confirmed the same latent gap really did
// exist elsewhere, so this is now a generic recursive merge (deepMergeDefaults
// above) applied across the whole globalSettings object instead of one
// hand-enumerated category — any future field addition backfills for free.
// Every read of a theme's config goes through this before reaching a
// caller, so an old row behaves exactly like a freshly-created one.
export function backfillGlobalSettings(config: ThemeConfig): ThemeConfig {
  return {
    ...config,
    globalSettings: deepMergeDefaults(
      DEFAULT_THEME_CONFIG.globalSettings,
      config.globalSettings,
    ),
  };
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Recursive — a block's own `blocks` (sub-blocks, e.g. Product card ->
// Media/Title/Price) get fresh ids too, at every depth.
function cloneBlock(block: ThemeBlock): ThemeBlock {
  return {
    ...block,
    id: generateId('blk'),
    settings: { ...block.settings },
    blocks: block.blocks?.map(cloneBlock),
  };
}

function cloneSectionShell(section: ThemeSection): ThemeSection {
  return {
    ...section,
    id: generateId('sec'),
    settings: { ...section.settings },
    blocks: section.blocks.map(cloneBlock),
  };
}

// Color scheme ids are referenced from several places (a section's own
// settings.schemeId, badges' saleSchemeId/soldOutSchemeId, drawers'/
// popovers' schemeId) — a naive fresh-id pass on colorSchemes alone would
// silently break every one of those references in the clone (they'd keep
// pointing at the SOURCE theme's scheme ids, which no longer exist in the
// clone). Build an old-id -> new-id map first, then rewrite every
// reference against it in a second pass, so a duplicated theme's "Edit
// scheme" links always point at its own cloned scheme.
function cloneColorSchemesWithRemap(schemes: ColorScheme[]): {
  clonedSchemes: ColorScheme[];
  idMap: Map<string, string>;
} {
  const idMap = new Map<string, string>();
  const clonedSchemes = schemes.map((scheme) => {
    const newId = generateId('scheme');
    idMap.set(scheme.id, newId);
    return { ...scheme, id: newId };
  });
  return { clonedSchemes, idMap };
}

// Unknown id (shouldn't happen against a well-formed config) passes
// through unchanged rather than silently vanishing the reference.
function remapSchemeId(id: string, idMap: Map<string, string>): string {
  return idMap.get(id) ?? id;
}

// Fresh ids on clone (theme duplication and the DEFAULT_THEME_CONFIG
// starting point) so two themes never share a section/block/scheme id — the
// admin editor's selection state and the storefront's React keys both rely
// on ids being unique per theme. Exported (not just used internally) since
// it's a pure function directly unit-tested in themes.service.spec.ts —
// see that file for the scheme-reference-remap-on-clone case specifically.
export function cloneConfigWithFreshIds(source: ThemeConfig): ThemeConfig {
  const { clonedSchemes, idMap } = cloneColorSchemesWithRemap(source.globalSettings.colorSchemes);

  const globalSettings: GlobalThemeSettings = {
    ...source.globalSettings,
    colorSchemes: clonedSchemes,
    badges: {
      ...source.globalSettings.badges,
      saleSchemeId: remapSchemeId(source.globalSettings.badges.saleSchemeId, idMap),
      soldOutSchemeId: remapSchemeId(source.globalSettings.badges.soldOutSchemeId, idMap),
    },
    drawers: {
      ...source.globalSettings.drawers,
      schemeId: remapSchemeId(source.globalSettings.drawers.schemeId, idMap),
    },
    popovers: {
      ...source.globalSettings.popovers,
      schemeId: remapSchemeId(source.globalSettings.popovers.schemeId, idMap),
    },
  };

  const cloneSection = (section: ThemeSection): ThemeSection => {
    const cloned = cloneSectionShell(section);
    const schemeId = cloned.settings.schemeId;
    if (typeof schemeId === 'string') {
      cloned.settings = { ...cloned.settings, schemeId: remapSchemeId(schemeId, idMap) };
    }
    return cloned;
  };

  return {
    globalSettings,
    header: { ...source.header, blocks: source.header.blocks.map(cloneBlock) },
    footer: { ...source.footer, blocks: source.footer.blocks.map(cloneBlock) },
    sections: source.sections.map(cloneSection),
  };
}

@Injectable()
export class ThemesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: ThemeConfigCache,
    private readonly jwtService: JwtService,
  ) {}

  async list(ctx: TenantContext) {
    return this.db.query<RowDataPacket[]>(
      `SELECT id, name, isPublished, publishedAt, updatedAt
       FROM theme
       WHERE shopId = ? AND deletedAt IS NULL
       ORDER BY updatedAt DESC`,
      [ctx.shopId],
    );
  }

  async findOne(ctx: TenantContext, id: number) {
    return this.getOwnedTheme(ctx, id);
  }

  // Session-cookie migration (security audit finding #1), phase 2 — the
  // theme builder's live preview embeds a token in the storefront iframe's
  // URL (see admin's PreviewFrame.tsx) so the storefront's own read
  // endpoints can bypass assertPublished for a shop that hasn't gone live
  // yet. That token used to just be the staff member's own real access
  // token (already sitting in localStorage); now that the real session is
  // an httpOnly cookie, PreviewFrame.tsx can't read it into a URL anymore.
  // This mints a separate, narrow, short-lived `typ: 'theme_preview'` token
  // instead — {shopId, exp} only, no user identity — deliberately meant to
  // be JS-readable and URL-embedded, unlike the real session. Verified the
  // same way the real session used to be, just against a narrower claim set
  // (see PublicService.isAuthorizedPreview).
  async issuePreviewToken(ctx: TenantContext, id: number) {
    await this.getOwnedTheme(ctx, id); // 404s if wrong shop or soft-deleted
    const previewToken = await this.jwtService.signAsync(
      { shopId: ctx.shopId, typ: 'theme_preview' },
      { expiresIn: '15m' },
    );
    return { previewToken };
  }

  // Phase G0 — Flow A: "new theme from template". Returns the built-in
  // starter templates' preview metadata for the library picker (never the
  // full config — the config only ever leaves the server as a created row).
  listTemplates() {
    return TEMPLATE_KEYS.map((key) => TEMPLATE_META[key]);
  }

  async create(ctx: TenantContext, dto: CreateThemeDto) {
    if (dto.duplicateFromId !== undefined && dto.fromTemplate !== undefined) {
      throw new BadRequestException('Provide at most one of duplicateFromId or fromTemplate');
    }

    let config: ThemeConfig;
    if (dto.duplicateFromId !== undefined) {
      const source = await this.getOwnedTheme(ctx, dto.duplicateFromId);
      config = cloneConfigWithFreshIds(source.config as ThemeConfig);
    } else if (dto.fromTemplate !== undefined) {
      // isTemplateKey is redundant with the DTO's @IsIn, but keeps the
      // index access type-safe and guards a direct service call.
      if (!isTemplateKey(dto.fromTemplate)) {
        throw new BadRequestException(`Unknown template: ${dto.fromTemplate}`);
      }
      config = cloneConfigWithFreshIds(THEME_TEMPLATES[dto.fromTemplate]);
    } else {
      config = cloneConfigWithFreshIds(DEFAULT_THEME_CONFIG);
    }

    const result = await this.db.execute(
      `INSERT INTO theme (shopId, name, config) VALUES (?, ?, ?)`,
      [ctx.shopId, dto.name, JSON.stringify(config)],
    );
    return this.getOwnedTheme(ctx, result.insertId);
  }

  async updateDraft(ctx: TenantContext, id: number, dto: UpdateThemeDraftDto) {
    await this.getOwnedTheme(ctx, id); // 404s if wrong shop or soft-deleted

    if (dto.config !== undefined) {
      assertValidThemeConfig(dto.config);
    }

    const built = buildSetClause({
      name: dto.name,
      config: dto.config !== undefined ? JSON.stringify(dto.config) : undefined,
    });
    if (built) {
      await this.db.execute(`UPDATE theme SET ${built.setClause} WHERE id = ? AND shopId = ?`, [
        ...built.params,
        id,
        ctx.shopId,
      ]);
    }
    return this.getOwnedTheme(ctx, id);
  }

  // Publish is the one-published-theme-per-shop CAS: unpublish whatever was
  // published, then publish this one, inside one transaction — MySQL has no
  // partial-unique-index equivalent to enforce "at most one isPublished=true
  // row per shopId" declaratively. Also flips themesettings.homepageLayout
  // (NOT a shop column — see theme/theme.service.ts, homepageLayout has
  // always lived on themesettings) to 'custom' (the value theme/constants.ts
  // already reserves for this builder) so the storefront's existing
  // homepageLayout dispatch picks up section-driven rendering as a side
  // effect of this specific action only — never touched by any other code
  // path. Upserted, not a plain UPDATE — a shop may not have a themesettings
  // row yet (see ThemeService.findOne's own "no row yet is a valid state"
  // comment); every other column falls back to its DB-level default.
  async publish(ctx: TenantContext, id: number) {
    await this.getOwnedTheme(ctx, id);
    await this.db.transaction(async (conn) => {
      await conn.query(
        `UPDATE theme SET isPublished = false WHERE shopId = ? AND isPublished = true`,
        [ctx.shopId],
      );
      await conn.query(
        `UPDATE theme SET isPublished = true, publishedConfig = config, publishedAt = NOW(3)
         WHERE id = ? AND shopId = ?`,
        [id, ctx.shopId],
      );
      await upsert(conn, 'themesettings', { shopId: ctx.shopId, homepageLayout: 'custom' }, [
        'homepageLayout',
      ]);
    });
    this.cache.invalidate(ctx.shopId);
    return this.getOwnedTheme(ctx, id);
  }

  // Soft delete. If the deleted theme was the published one, resets
  // themesettings.homepageLayout back to 'classic' and invalidates the
  // cache — a merchant should never be left with a live storefront pointing
  // at a deleted theme's now-stale published config.
  async remove(ctx: TenantContext, id: number) {
    const theme = await this.getOwnedTheme(ctx, id);
    await this.db.execute(`UPDATE theme SET deletedAt = NOW(3) WHERE id = ? AND shopId = ?`, [
      id,
      ctx.shopId,
    ]);
    if (theme.isPublished) {
      await upsert(this.db.pool, 'themesettings', { shopId: ctx.shopId, homepageLayout: 'classic' }, [
        'homepageLayout',
      ]);
      this.cache.invalidate(ctx.shopId);
    }
    return { success: true };
  }

  // Public/storefront-facing read — resolved shopId only (no TenantContext;
  // the caller is PublicService, which has already resolved shopSlug ->
  // shop.id itself). Preview requests bypass the cache entirely (drafts
  // change on every autosave/postMessage tick, and only the merchant's own
  // admin session ever hits this path) and are additionally shop-scoped so a
  // guessed cross-shop themeId 404s rather than leaking another shop's
  // draft.
  async getPublicConfig(
    shopId: number,
    opts: { preview: boolean; themeId?: number },
  ): Promise<ThemeConfig | null> {
    if (opts.preview) {
      if (opts.themeId === undefined) {
        throw new BadRequestException('themeId is required when preview=true');
      }
      const rows = await this.db.query<(ThemeRow & RowDataPacket)[]>(
        `SELECT * FROM theme WHERE id = ? AND shopId = ? AND deletedAt IS NULL`,
        [opts.themeId, shopId],
      );
      const theme = rows[0];
      if (!theme) {
        throw new NotFoundException(`Theme ${opts.themeId} not found`);
      }
      return backfillGlobalSettings(theme.config as ThemeConfig);
    }

    const cached = this.cache.get(shopId);
    if (cached.hit) return cached.config;

    const rows = await this.db.query<(ThemeRow & RowDataPacket)[]>(
      `SELECT * FROM theme WHERE shopId = ? AND isPublished = true AND deletedAt IS NULL LIMIT 1`,
      [shopId],
    );
    const theme = rows[0];
    const config = theme && theme.publishedConfig ? backfillGlobalSettings(theme.publishedConfig as ThemeConfig) : null;
    this.cache.set(shopId, config);
    return config;
  }

  private async getOwnedTheme(ctx: TenantContext, id: number): Promise<ThemeRow> {
    const rows = await this.db.query<(ThemeRow & RowDataPacket)[]>(
      `SELECT * FROM theme WHERE id = ? AND shopId = ? AND deletedAt IS NULL`,
      [id, ctx.shopId],
    );
    const theme = rows[0];
    if (!theme) {
      throw new NotFoundException(`Theme ${id} not found`);
    }
    theme.config = backfillGlobalSettings(theme.config as ThemeConfig);
    return theme;
  }
}
