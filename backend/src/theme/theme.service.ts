import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService, type QueryParam } from '../database/database.service';
import { upsert } from '../database/upsert.util';
import type { RowDataPacket } from 'mysql2/promise';
import type { ThemesettingsRow, BannerimageRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { UpdateThemeDto } from './dto/update-theme.dto';
import { THEME_COLOR_KEYS } from './constants';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const VALID_COLOR_KEYS = new Set(THEME_COLOR_KEYS);

// Every themesettings column that can be sent via UpdateThemeDto, and its
// create-time default — mirrors findOne()'s own "no row yet" fallback shape.
const THEME_FIELD_DEFAULTS: Record<string, QueryParam> = {
  logoUrl: null,
  bannerUrl: null,
  brandColor: null,
  secondaryColor: null,
  heroText: null,
  faviconUrl: null,
  fontFamily: null,
  footerLogoUrl: null,
  footerDescription: null,
  notificationText: null,
  contactNumbers: null,
  colors: null,
  announcementBarEnabled: false,
  announcementBarScrolling: false,
  homepageLayout: 'classic',
  homeTabMode: 'templates',
  topBarLayout: 'logo_left',
  iconStyle: 'outline',
  buttonRadius: 'rounded',
  buttonFill: 'solid',
  pdpLayout: 'gallery_left',
  cartLayout: 'full_page',
  checkoutLayout: 'single_page',
  footerLayout: 'columns',
  headerDensity: 'regular',
  footerDensity: 'regular',
};
const THEME_JSON_COLUMNS = new Set(['notificationText', 'contactNumbers', 'colors']);

@Injectable()
export class ThemeService {
  constructor(private readonly db: DatabaseService) {}

  async findOne(ctx: TenantContext) {
    const [themeRows, images] = await Promise.all([
      this.db.query<(ThemesettingsRow & RowDataPacket)[]>(
        `SELECT * FROM themesettings WHERE shopId = ?`,
        [ctx.shopId],
      ),
      // bannerimage relates to shop directly, not themesettings (see the
      // model's own schema comment — banners shouldn't depend on a
      // themesettings row existing yet), so this is always a second query.
      this.db.query<(BannerimageRow & RowDataPacket)[]>(
        `SELECT * FROM bannerimage WHERE shopId = ? ORDER BY \`order\` ASC`,
        [ctx.shopId],
      ),
    ]);
    // No row yet (never saved) is a real, valid state — not an error. The
    // admin UI and storefront both already treat every field here as
    // nullable-with-a-default, so returning an all-null shape lets the
    // theme page render with its defaults pre-filled rather than a 404.
    // `images` merges in either way — it's always a real query result
    // (possibly empty), never conditional on whether a themesettings row
    // exists yet.
    return {
      ...(themeRows[0] ?? {
        shopId: ctx.shopId,
        ...THEME_FIELD_DEFAULTS,
        updatedAt: null,
      }),
      images,
    };
  }

  async upsert(ctx: TenantContext, dto: UpdateThemeDto) {
    if (dto.colors) this.assertValidColors(dto.colors);
    // images lives in a separate table (see the model comment) — pulled out
    // of dto before the plain themesettings upsert, handled as its own
    // delete-all-then-recreate step in the same transaction, same pattern
    // ProductsService.update uses for productimage.
    const { images, ...themeFields } = dto;

    // bannerUrl stays in sync with the first (order-0) banner image, same
    // "the single legacy field mirrors the multi-image list's first entry"
    // pattern ProductsService uses to keep product.thumbnail in sync with
    // productimage — non-Slideshow layouts (ClassicHero, FeaturedGrid) still
    // read shop.bannerUrl directly and would otherwise never see anything
    // saved through the banner manager, which only ever wrote to `images`.
    // Only touched when images is actually part of this save (undefined
    // means "not being changed this call," same as every other optional
    // DTO field) — an explicit images:[] (all banners removed) clears it.
    const bannerUrlSync: { bannerUrl?: string | null } =
      images !== undefined ? { bannerUrl: images[0]?.url ?? null } : {};
    const merged: Record<string, unknown> = { ...themeFields, ...bannerUrlSync };

    const values: Record<string, QueryParam> = {
      shopId: ctx.shopId,
      updatedAt: new Date(),
    };
    for (const [key, defaultValue] of Object.entries(THEME_FIELD_DEFAULTS)) {
      const raw = merged[key];
      if (raw === undefined) {
        values[key] = defaultValue;
      } else {
        values[key] = THEME_JSON_COLUMNS.has(key)
          ? JSON.stringify(raw)
          : (raw as QueryParam);
      }
    }
    // Filter to keys with a real value, not just Object.keys(merged) —
    // class-transformer can pre-declare every DTO field as an own property
    // set to `undefined` even when the request never sent it, so an
    // unfiltered key list would tell the UPDATE branch to overwrite every
    // untouched field back to its create-time default on every save. Found
    // for real: a second PATCH sending only brandColor was wiping
    // fontFamily/heroText/secondaryColor back to null.
    const updateColumns = [
      'updatedAt',
      ...Object.keys(merged).filter((k) => merged[k] !== undefined),
    ];

    await this.db.transaction(async (conn) => {
      await upsert(conn, 'themesettings', values, updateColumns);
      if (images !== undefined) {
        await conn.query(`DELETE FROM bannerimage WHERE shopId = ?`, [ctx.shopId]);
        if (images.length > 0) {
          const placeholders = images.map(() => '(?, ?, ?, ?)').join(', ');
          const params = images.flatMap((img, i) => [
            ctx.shopId,
            img.url,
            img.linkUrl ?? null,
            img.order ?? i,
          ]);
          await conn.query(
            `INSERT INTO bannerimage (shopId, url, linkUrl, \`order\`) VALUES ${placeholders}`,
            params,
          );
        }
      }
    });

    return this.findOne(ctx);
  }

  // Manual validation rather than a class-validator decorator, since
  // `colors` is a loosely-typed Record — this is simpler than building a
  // custom decorator for one field. Rejects both unknown keys (typos, or a
  // stale client sending a since-renamed key) and non-hex values, same
  // strictness the DTO already applies to brandColor/secondaryColor.
  private assertValidColors(colors: Record<string, string>) {
    for (const [key, value] of Object.entries(colors)) {
      if (!VALID_COLOR_KEYS.has(key)) {
        throw new BadRequestException(`Unknown theme color key: '${key}'`);
      }
      if (!HEX_COLOR.test(value)) {
        throw new BadRequestException(
          `colors.${key} must be a hex color like #069494`,
        );
      }
    }
  }
}
