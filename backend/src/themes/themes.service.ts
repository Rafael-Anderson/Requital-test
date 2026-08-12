import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { buildSetClause } from '../database/update.util';
import type { TenantContext } from '../common/tenant-context';
import type { ThemeRow } from '../db/types';
import { CreateThemeDto } from './dto/create-theme.dto';
import { UpdateThemeDraftDto } from './dto/update-theme-draft.dto';
import { DEFAULT_THEME_CONFIG } from './constants';
import { assertValidThemeConfig } from './theme-config.validation';
import { ThemeConfigCache } from './theme-config-cache';
import type { ThemeConfig, ThemeElement, ThemeSection } from './theme-config.types';

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Fresh ids on clone (theme duplication and the DEFAULT_THEME_CONFIG
// starting point) so two themes never share a section/element id — the
// admin editor's selectedSectionId/selectedElementId and the storefront's
// React key both rely on ids being unique per theme.
function cloneConfigWithFreshIds(source: ThemeConfig): ThemeConfig {
  const cloneElement = (el: ThemeElement): ThemeElement => ({
    ...el,
    id: generateId('el'),
  });
  const cloneSection = (section: ThemeSection): ThemeSection => ({
    ...section,
    id: generateId('sec'),
    settings: { ...section.settings },
    elements: section.elements?.map(cloneElement),
  });
  return {
    globalSettings: { ...source.globalSettings },
    header: { ...source.header, elements: source.header.elements?.map(cloneElement) },
    footer: { ...source.footer, elements: source.footer.elements?.map(cloneElement) },
    sections: source.sections.map(cloneSection),
  };
}

@Injectable()
export class ThemesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: ThemeConfigCache,
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

  async create(ctx: TenantContext, dto: CreateThemeDto) {
    let config: ThemeConfig;
    if (dto.duplicateFromId !== undefined) {
      const source = await this.getOwnedTheme(ctx, dto.duplicateFromId);
      config = cloneConfigWithFreshIds(source.config as ThemeConfig);
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
  // row per shopId" declaratively. Also flips shop.homepageLayout to
  // 'custom' (the value theme/constants.ts already reserves for this
  // builder) so the storefront's existing homepageLayout dispatch picks up
  // section-driven rendering as a side effect of this specific action only —
  // never touched by any other code path.
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
      await conn.query(`UPDATE shop SET homepageLayout = 'custom' WHERE id = ?`, [ctx.shopId]);
    });
    this.cache.invalidate(ctx.shopId);
    return this.getOwnedTheme(ctx, id);
  }

  // Soft delete. If the deleted theme was the published one, resets
  // shop.homepageLayout back to 'classic' and invalidates the cache — a
  // merchant should never be left with a live storefront pointing at a
  // deleted theme's now-stale published config.
  async remove(ctx: TenantContext, id: number) {
    const theme = await this.getOwnedTheme(ctx, id);
    await this.db.execute(`UPDATE theme SET deletedAt = NOW(3) WHERE id = ? AND shopId = ?`, [
      id,
      ctx.shopId,
    ]);
    if (theme.isPublished) {
      await this.db.execute(`UPDATE shop SET homepageLayout = 'classic' WHERE id = ?`, [
        ctx.shopId,
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
      return theme.config as ThemeConfig;
    }

    const cached = this.cache.get(shopId);
    if (cached.hit) return cached.config;

    const rows = await this.db.query<(ThemeRow & RowDataPacket)[]>(
      `SELECT * FROM theme WHERE shopId = ? AND isPublished = true AND deletedAt IS NULL LIMIT 1`,
      [shopId],
    );
    const theme = rows[0];
    const config = theme ? (theme.publishedConfig as ThemeConfig | null) : null;
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
    return theme;
  }
}
