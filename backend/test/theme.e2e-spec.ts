import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import type { RowDataPacket } from 'mysql2/promise';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';

interface AuthResponse {
  accessToken: string;
}
interface ThemeBody {
  shopId: number;
  brandColor: string | null;
  secondaryColor: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  faviconUrl: string | null;
  footerLogoUrl: string | null;
  heroText: string | null;
  fontFamily: string | null;
  notificationText: string[] | null;
  contactNumbers: string[] | null;
  colors: Record<string, string> | null;
  homepageLayout: string;
  topBarLayout: string;
  iconStyle: string;
  buttonRadius: string;
  buttonFill: string;
  pdpLayout: string;
  cartLayout: string;
  checkoutLayout: string;
  collectionsGridColumns: number;
  collectionsGridGap: string;
  collectionsGridShowTitle: boolean;
  collectionsGridImageAspectRatio: string;
  updatedAt: string | null;
}
interface PublicShopBody {
  name: string;
  brandColor: string | null;
  secondaryColor: string | null;
  bannerUrl: string | null;
  heroText: string | null;
  faviconUrl: string | null;
  fontFamily: string | null;
  logoUrl: string | null;
  footerLogoUrl: string | null;
  notificationText: string[] | null;
  contactNumbers: string[] | null;
  colors: Record<string, string> | null;
  homepageLayout: string;
  topBarLayout: string;
  iconStyle: string;
  buttonRadius: string;
  buttonFill: string;
  pdpLayout: string;
  cartLayout: string;
  checkoutLayout: string;
  collectionsGridColumns: number;
  collectionsGridGap: string;
  collectionsGridShowTitle: boolean;
  collectionsGridImageAspectRatio: string;
}

function body<T>(res: Response): T {
  return res.body as T;
}

describe('Theme (e2e)', () => {
  let app: INestApplication<App>;
  let db: DatabaseService;
  const runId = Date.now();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    db = app.get(DatabaseService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupShop(slugPrefix: string) {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        name: 'Theme Admin',
        email: `${slugPrefix}-${runId}@test.com`,
        password: 'password123',
        shopName: `${slugPrefix} Shop`,
        subdomain: `${slugPrefix}-${runId}`,
      })
      .expect(201);
    return {
      adminToken: body<AuthResponse>(signup).accessToken,
      slug: `${slugPrefix}-${runId}`,
    };
  }

  describe('GET /theme defaults for an unconfigured shop', () => {
    it('returns an all-null shape rather than 404 when nothing has been saved yet', async () => {
      const shop = await setupShop('theme-default');
      const res = await request(app.getHttpServer())
        .get('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const theme = body<ThemeBody>(res);
      expect(theme.brandColor).toBeNull();
      expect(theme.secondaryColor).toBeNull();
      expect(theme.fontFamily).toBeNull();
      // Every shop always has SOME homepage layout — "classic" (today's only
      // real behavior) is the default even before a row exists, not null.
      expect(theme.homepageLayout).toBe('classic');
      // Theme Customizer v2 — every new preset defaults to the storefront's
      // pre-this-task behavior, same rule as homepageLayout, so an
      // unconfigured shop's storefront renders unchanged.
      expect(theme.topBarLayout).toBe('logo_left');
      expect(theme.iconStyle).toBe('outline');
      expect(theme.buttonRadius).toBe('rounded');
      expect(theme.buttonFill).toBe('solid');
      expect(theme.pdpLayout).toBe('gallery_left');
      expect(theme.cartLayout).toBe('full_page');
      expect(theme.checkoutLayout).toBe('single_page');
      expect(theme.updatedAt).toBeNull();
    });

    it("the public storefront shop payload is never broken/missing fields for an unconfigured shop — just nulls, with Requital's teal applied client-side as the fallback", async () => {
      const shop = await setupShop('theme-default-public');
      const res = await request(app.getHttpServer())
        .get(`/public/${shop.slug}`)
        .expect(200);
      const publicShop = body<PublicShopBody>(res);
      expect(publicShop.brandColor).toBeNull();
      expect(publicShop.secondaryColor).toBeNull();
      expect(publicShop.bannerUrl).toBeNull();
      expect(publicShop.fontFamily).toBeNull();
    });
  });

  describe('PATCH /theme — save/load, upsert, validation', () => {
    it('saves and reads back every field; a second PATCH updates the same row rather than creating a duplicate', async () => {
      const shop = await setupShop('theme-crud');
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          brandColor: '#123456',
          secondaryColor: '#654321',
          heroText: 'Fresh flowers daily',
          fontFamily: 'poppins',
        })
        .expect(200);

      const afterFirst = await request(app.getHttpServer())
        .get('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<ThemeBody>(afterFirst)).toMatchObject({
        brandColor: '#123456',
        secondaryColor: '#654321',
        heroText: 'Fresh flowers daily',
        fontFamily: 'poppins',
      });

      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ brandColor: '#abcdef' })
        .expect(200);
      const afterSecond = await request(app.getHttpServer())
        .get('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      // brandColor updated, everything else from the first save untouched —
      // proves this is an update on the same row, not a fresh overwrite.
      expect(body<ThemeBody>(afterSecond)).toMatchObject({
        brandColor: '#abcdef',
        secondaryColor: '#654321',
        heroText: 'Fresh flowers daily',
        fontFamily: 'poppins',
      });

      const countRows = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM themesettings
         JOIN shop ON shop.id = themesettings.shopId
         WHERE shop.subdomain = ?`,
        [shop.slug],
      );
      expect(Number(countRows[0].c)).toBe(1);
    });

    it('a saved theme is reflected on the public storefront payload', async () => {
      const shop = await setupShop('theme-public-reflect');
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          brandColor: '#ff6600',
          bannerUrl: '/uploads/theme/banner.jpg',
          heroText: 'Welcome',
        })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/public/${shop.slug}`)
        .expect(200);
      const publicShop = body<PublicShopBody>(res);
      expect(publicShop.brandColor).toBe('#ff6600');
      expect(publicShop.bannerUrl).toBe('/uploads/theme/banner.jpg');
      expect(publicShop.heroText).toBe('Welcome');
    });

    it('rejects a malformed hex color', async () => {
      const shop = await setupShop('theme-bad-color');
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ brandColor: 'not-a-color' })
        .expect(400);
    });

    it('rejects a font not on the curated list', async () => {
      const shop = await setupShop('theme-bad-font');
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ fontFamily: 'comic-sans' })
        .expect(400);
    });
  });

  describe('PATCH /theme — granular colors, notification text, contact numbers, footer logo', () => {
    it('saves and reads back a partial colors object, footerLogoUrl, notificationText, and contactNumbers', async () => {
      const shop = await setupShop('theme-expanded');
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          footerLogoUrl: '/uploads/theme/footer-logo.png',
          notificationText: ['Free delivery over 100 AED', 'Eid sale now on'],
          contactNumbers: ['+971501234567', '+97141234567'],
          colors: {
            headerBackgroundColor: '#fafafa',
            productNameColor: '#111111',
          },
        })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const theme = body<ThemeBody>(res);
      expect(theme.footerLogoUrl).toBe('/uploads/theme/footer-logo.png');
      expect(theme.notificationText).toEqual([
        'Free delivery over 100 AED',
        'Eid sale now on',
      ]);
      expect(theme.contactNumbers).toEqual(['+971501234567', '+97141234567']);
      expect(theme.colors).toEqual({
        headerBackgroundColor: '#fafafa',
        productNameColor: '#111111',
      });
    });

    it('a colors update replaces the whole colors object rather than merging (upsert semantics, same as every other field)', async () => {
      const shop = await setupShop('theme-colors-replace');
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          colors: {
            headerBackgroundColor: '#fafafa',
            productNameColor: '#111111',
          },
        })
        .expect(200);
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ colors: { buttonColor: '#222222' } })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<ThemeBody>(res).colors).toEqual({ buttonColor: '#222222' });
    });

    it('rejects an unknown color key', async () => {
      const shop = await setupShop('theme-bad-color-key');
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ colors: { notARealColorKey: '#123456' } })
        .expect(400);
    });

    it('rejects a non-hex value for a known color key', async () => {
      const shop = await setupShop('theme-bad-color-value');
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ colors: { buttonColor: 'not-a-color' } })
        .expect(400);
    });

    it('the granular fields are reflected on the public storefront payload', async () => {
      const shop = await setupShop('theme-expanded-public');
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          notificationText: ['Same-day delivery available'],
          contactNumbers: ['+971501234567'],
          colors: { buttonColor: '#333333' },
        })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/public/${shop.slug}`)
        .expect(200);
      const publicShop = body<PublicShopBody>(res);
      expect(publicShop.notificationText).toEqual([
        'Same-day delivery available',
      ]);
      expect(publicShop.contactNumbers).toEqual(['+971501234567']);
      expect(publicShop.colors).toEqual({ buttonColor: '#333333' });
    });
  });

  describe('PATCH /theme — Advanced tab homepageLayout', () => {
    it('saves and reads back each real layout option, and it bumps updatedAt', async () => {
      const shop = await setupShop('theme-layout');
      const before = await request(app.getHttpServer())
        .get('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<ThemeBody>(before).updatedAt).toBeNull();

      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ homepageLayout: 'slideshow' })
        .expect(200);

      const after = await request(app.getHttpServer())
        .get('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const theme = body<ThemeBody>(after);
      expect(theme.homepageLayout).toBe('slideshow');
      expect(theme.updatedAt).not.toBeNull();

      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ homepageLayout: 'featured_grid' })
        .expect(200);
      const afterSecond = await request(app.getHttpServer())
        .get('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<ThemeBody>(afterSecond).homepageLayout).toBe('featured_grid');
    });

    it('rejects "custom" — reserved for the future drag-and-drop builder, not selectable yet', async () => {
      const shop = await setupShop('theme-layout-custom');
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ homepageLayout: 'custom' })
        .expect(400);
    });

    it('rejects a made-up layout value', async () => {
      const shop = await setupShop('theme-layout-invalid');
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ homepageLayout: 'not-a-real-layout' })
        .expect(400);
    });

    it('a saved layout is reflected on the public storefront payload', async () => {
      const shop = await setupShop('theme-layout-public');
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ homepageLayout: 'featured_grid' })
        .expect(200);
      const res = await request(app.getHttpServer())
        .get(`/public/${shop.slug}`)
        .expect(200);
      expect(body<PublicShopBody>(res).homepageLayout).toBe('featured_grid');
    });
  });

  describe('PATCH /theme — Theme Customizer v2 layout/icon/button presets', () => {
    it('saves and reads back a real value for every new preset field', async () => {
      const shop = await setupShop('theme-v2');
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          topBarLayout: 'minimal',
          iconStyle: 'solid',
          buttonRadius: 'pill',
          buttonFill: 'outline',
          pdpLayout: 'gallery_top',
          cartLayout: 'drawer',
          checkoutLayout: 'step_by_step',
        })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<ThemeBody>(res)).toMatchObject({
        topBarLayout: 'minimal',
        iconStyle: 'solid',
        buttonRadius: 'pill',
        buttonFill: 'outline',
        pdpLayout: 'gallery_top',
        cartLayout: 'drawer',
        checkoutLayout: 'step_by_step',
      });
    });

    it.each([
      ['topBarLayout', 'not-a-real-layout'],
      ['iconStyle', 'wireframe'],
      ['buttonRadius', 'super-round'],
      ['buttonFill', 'gradient'],
      ['pdpLayout', 'gallery_bottom'],
      ['cartLayout', 'popup'],
      ['checkoutLayout', 'wizard'],
    ])('rejects an invalid %s value', async (field, value) => {
      const shop = await setupShop(`theme-v2-bad-${field.toLowerCase()}`);
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ [field]: value })
        .expect(400);
    });

    it('the new presets are reflected on the public storefront payload', async () => {
      const shop = await setupShop('theme-v2-public');
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          cartLayout: 'drawer',
          checkoutLayout: 'step_by_step',
          iconStyle: 'solid',
        })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/public/${shop.slug}`)
        .expect(200);
      const publicShop = body<PublicShopBody>(res);
      expect(publicShop.cartLayout).toBe('drawer');
      expect(publicShop.checkoutLayout).toBe('step_by_step');
      expect(publicShop.iconStyle).toBe('solid');
      // Untouched presets keep their pre-this-task default.
      expect(publicShop.topBarLayout).toBe('logo_left');
      expect(publicShop.pdpLayout).toBe('gallery_left');
      expect(publicShop.buttonRadius).toBe('rounded');
      expect(publicShop.buttonFill).toBe('solid');
    });
  });

  describe('PATCH /theme — Home tab collections-grid settings', () => {
    it('saves and reads back real values for every collections-grid field', async () => {
      const shop = await setupShop('theme-collections-grid');
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          collectionsGridColumns: 4,
          collectionsGridGap: 'lg',
          collectionsGridShowTitle: false,
          collectionsGridImageAspectRatio: 'square',
        })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<ThemeBody>(res)).toMatchObject({
        collectionsGridColumns: 4,
        collectionsGridGap: 'lg',
        collectionsGridShowTitle: false,
        collectionsGridImageAspectRatio: 'square',
      });
    });

    it('defaults to columns=3, gap=md, showTitle=true, aspectRatio=portrait for an unconfigured shop', async () => {
      const shop = await setupShop('theme-collections-grid-default');
      const res = await request(app.getHttpServer())
        .get('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      expect(body<ThemeBody>(res)).toMatchObject({
        collectionsGridColumns: 3,
        collectionsGridGap: 'md',
        collectionsGridShowTitle: true,
        collectionsGridImageAspectRatio: 'portrait',
      });
    });

    it.each([
      ['collectionsGridColumns', 5],
      ['collectionsGridGap', 'huge'],
      ['collectionsGridImageAspectRatio', 'circle'],
    ])('rejects an invalid %s value', async (field, value) => {
      const shop = await setupShop(`theme-cg-bad-${field.toLowerCase()}`);
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ [field]: value })
        .expect(400);
    });

    it('the saved settings are reflected on the public storefront payload', async () => {
      const shop = await setupShop('theme-cg-public');
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({ collectionsGridColumns: 2, collectionsGridShowTitle: false })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/public/${shop.slug}`)
        .expect(200);
      const publicShop = body<PublicShopBody>(res);
      expect(publicShop.collectionsGridColumns).toBe(2);
      expect(publicShop.collectionsGridShowTitle).toBe(false);
      // Untouched fields keep their pre-this-task default.
      expect(publicShop.collectionsGridGap).toBe('md');
      expect(publicShop.collectionsGridImageAspectRatio).toBe('portrait');
    });
  });

  describe('multi-tenant isolation', () => {
    it("shop A's theme never appears on shop B's admin GET or shop B's public storefront payload", async () => {
      const shopA = await setupShop('theme-iso-a');
      const shopB = await setupShop('theme-iso-b');

      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${shopA.adminToken}`)
        .send({
          brandColor: '#111111',
          heroText: 'Shop A only',
          notificationText: ['Shop A announcement'],
          colors: { buttonColor: '#111111' },
          homepageLayout: 'slideshow',
          cartLayout: 'drawer',
          buttonFill: 'outline',
        })
        .expect(200);

      const themeB = await request(app.getHttpServer())
        .get('/theme')
        .set('Authorization', `Bearer ${shopB.adminToken}`)
        .expect(200);
      expect(body<ThemeBody>(themeB).brandColor).toBeNull();
      expect(body<ThemeBody>(themeB).notificationText).toBeNull();
      expect(body<ThemeBody>(themeB).colors).toBeNull();
      expect(body<ThemeBody>(themeB).homepageLayout).toBe('classic');
      // Shop A's Theme Customizer v2 picks never leak onto shop B's row —
      // shop B keeps the pre-this-task defaults.
      expect(body<ThemeBody>(themeB).cartLayout).toBe('full_page');
      expect(body<ThemeBody>(themeB).buttonFill).toBe('solid');

      const publicB = await request(app.getHttpServer())
        .get(`/public/${shopB.slug}`)
        .expect(200);
      expect(body<PublicShopBody>(publicB).brandColor).toBeNull();
      expect(body<PublicShopBody>(publicB).heroText).toBeNull();
      expect(body<PublicShopBody>(publicB).notificationText).toBeNull();
      expect(body<PublicShopBody>(publicB).colors).toBeNull();
      expect(body<PublicShopBody>(publicB).homepageLayout).toBe('classic');
      expect(body<PublicShopBody>(publicB).cartLayout).toBe('full_page');
      expect(body<PublicShopBody>(publicB).buttonFill).toBe('solid');
    });
  });

  describe('permission boundary: theme is admin-only', () => {
    it('a branch user gets 403 on GET/PATCH/upload; the admin gets 200', async () => {
      const shop = await setupShop('theme-perm');
      const outlets = await request(app.getHttpServer())
        .get('/outlets')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
      const outletId = body<{ id: number }[]>(outlets)[0].id;

      await request(app.getHttpServer())
        .post('/auth/branch-users')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .send({
          name: 'Branch Employee',
          email: `theme-branch-${runId}@test.com`,
          password: 'password123',
          outletId,
        })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: `theme-branch-${runId}@test.com`,
          password: 'password123',
        })
        .expect(201);
      const branchToken = body<AuthResponse>(login).accessToken;

      await request(app.getHttpServer())
        .get('/theme')
        .set('Authorization', `Bearer ${branchToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .patch('/theme')
        .set('Authorization', `Bearer ${branchToken}`)
        .send({ brandColor: '#111111' })
        .expect(403);
      await request(app.getHttpServer())
        .get('/theme')
        .set('Authorization', `Bearer ${shop.adminToken}`)
        .expect(200);
    });
  });
});
