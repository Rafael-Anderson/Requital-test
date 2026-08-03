import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import { UpdateThemeDto } from './dto/update-theme.dto';
import { THEME_COLOR_KEYS } from './constants';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const VALID_COLOR_KEYS = new Set(THEME_COLOR_KEYS);

@Injectable()
export class ThemeService {
  constructor(private readonly prisma: PrismaService) {}

  async findOne(ctx: TenantContext) {
    const [theme, images] = await Promise.all([
      this.prisma.themesettings.findUnique({ where: { shopId: ctx.shopId } }),
      // bannerimage relates to shop directly, not themesettings (see the
      // model's own schema comment — banners shouldn't depend on a
      // themesettings row existing yet), so this is always a second query,
      // never a Prisma `include`.
      this.prisma.bannerimage.findMany({
        where: { shopId: ctx.shopId },
        orderBy: { order: 'asc' },
      }),
    ]);
    // No row yet (never saved) is a real, valid state — not an error. The
    // admin UI and storefront both already treat every field here as
    // nullable-with-a-default, so returning an all-null shape lets the
    // theme page render with its defaults pre-filled rather than a 404.
    // `images` merges in either way — it's always a real query result
    // (possibly empty), never conditional on whether a themesettings row
    // exists yet.
    return {
      ...(theme ?? {
        shopId: ctx.shopId,
        brandColor: null,
        secondaryColor: null,
        logoUrl: null,
        bannerUrl: null,
        faviconUrl: null,
        footerLogoUrl: null,
        footerDescription: null,
        heroText: null,
        fontFamily: null,
        notificationText: null,
        contactNumbers: null,
        announcementBarEnabled: false,
        announcementBarScrolling: false,
        colors: null,
        homepageLayout: 'classic',
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
    const bannerUrlSync =
      images !== undefined ? { bannerUrl: images[0]?.url ?? null } : {};

    const [theme] = await this.prisma.$transaction([
      this.prisma.themesettings.upsert({
        where: { shopId: ctx.shopId },
        create: { shopId: ctx.shopId, ...themeFields, ...bannerUrlSync },
        update: { ...themeFields, ...bannerUrlSync },
      }),
      ...(images !== undefined
        ? [
            this.prisma.bannerimage.deleteMany({
              where: { shopId: ctx.shopId },
            }),
            this.prisma.bannerimage.createMany({
              data: images.map((img, i) => ({
                shopId: ctx.shopId,
                url: img.url,
                linkUrl: img.linkUrl ?? null,
                order: img.order ?? i,
              })),
            }),
          ]
        : []),
    ]);
    const currentImages = await this.prisma.bannerimage.findMany({
      where: { shopId: ctx.shopId },
      orderBy: { order: 'asc' },
    });
    return { ...theme, images: currentImages };
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
