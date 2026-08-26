// Focused unit coverage for PublicService.assertPublishedOrPreview /
// isAuthorizedPreview — the theme builder's live-preview bypass for an
// unpublished shop (see PreviewFrame.tsx's own comment for why this exists).
// The property that actually matters here is the cross-shop rejection: a
// valid theme_preview token minted for shop A must never unlock shop B's
// unpublished content, since previewToken is otherwise just a
// client-suppliable value riding along on an unauthenticated @Public()
// route. Uses a real JwtService (not mocked) so the test exercises real
// sign/verify semantics, not just "was verifyAsync called" — everything
// else PublicService depends on is untouched by this code path, so it's
// stubbed rather than fully mocked, same convention as this codebase's
// other service.spec.ts files.
//
// Session-cookie migration (security audit finding #1), phase 2 — this
// token used to be the staff member's own real `{sub, typ:'staff'}` access
// token, with isAuthorizedPreview doing a DB lookup to resolve sub -> shopId.
// It's now a separate, narrow `{shopId, typ:'theme_preview'}` token minted
// by ThemesService.issuePreviewToken (see that method's own comment for
// why) — shopId rides directly in the claims, so there's no more DB lookup
// on this path at all.
import { NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PublicService } from './public.service';
import type { DatabaseService } from '../database/database.service';

const SECRET = 'test-secret';

function createMockDb() {
  const query = jest.fn();
  return { query } as unknown as DatabaseService & { query: jest.Mock };
}

function buildService(db: DatabaseService) {
  const jwtService = new JwtService({ secret: SECRET });
  const unused = {} as never;
  const service = new PublicService(
    db,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    jwtService,
  );
  return { service, jwtService };
}

const UNPUBLISHED_SHOP_ROW = {
  id: 1,
  subdomain: 'unpublished-shop',
  published: false,
};

describe('PublicService preview-auth bypass (listOutlets)', () => {
  it('serves outlets normally for a published shop, no token needed', async () => {
    const db = createMockDb();
    db.query
      .mockResolvedValueOnce([
        { id: 1, subdomain: 'live-shop', published: true },
      ])
      .mockResolvedValueOnce([{ id: 10, name: 'Main Branch' }]);
    const { service } = buildService(db);

    const result = await service.listOutlets('live-shop');
    expect(result).toHaveLength(1);
  });

  it('rejects an unpublished shop with no previewToken', async () => {
    const db = createMockDb();
    db.query.mockResolvedValueOnce([UNPUBLISHED_SHOP_ROW]);
    const { service } = buildService(db);

    await expect(service.listOutlets('unpublished-shop')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects an unpublished shop with a garbage previewToken', async () => {
    const db = createMockDb();
    db.query.mockResolvedValueOnce([UNPUBLISHED_SHOP_ROW]);
    const { service } = buildService(db);

    await expect(
      service.listOutlets('unpublished-shop', 'not-a-real-jwt'),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a valid theme_preview token minted for a DIFFERENT shop (the property that actually matters)', async () => {
    const db = createMockDb();
    const otherShopJwt = new JwtService({ secret: SECRET });
    const tokenForShop2 = await otherShopJwt.signAsync({
      shopId: 2,
      typ: 'theme_preview',
    });

    db.query.mockResolvedValueOnce([UNPUBLISHED_SHOP_ROW]); // resolveShop -> shop id 1
    const { service } = buildService(db);

    await expect(
      service.listOutlets('unpublished-shop', tokenForShop2),
    ).rejects.toThrow(NotFoundException);
  });

  it("accepts a valid theme_preview token minted for THIS shop's own unpublished shop", async () => {
    const db = createMockDb();
    const { service, jwtService } = buildService(db);
    const token = await jwtService.signAsync({
      shopId: 1,
      typ: 'theme_preview',
    });

    db.query
      .mockResolvedValueOnce([UNPUBLISHED_SHOP_ROW]) // resolveShop -> shop id 1
      .mockResolvedValueOnce([{ id: 10, name: 'Main Branch' }]); // the actual outlets query

    const result = await service.listOutlets('unpublished-shop', token);
    expect(result).toHaveLength(1);
  });

  it('rejects a token with the right shopId but the wrong typ (must be theme_preview)', async () => {
    const db = createMockDb();
    const { service, jwtService } = buildService(db);
    const wrongTypToken = await jwtService.signAsync({
      shopId: 1,
      typ: 'staff',
    });

    db.query.mockResolvedValueOnce([UNPUBLISHED_SHOP_ROW]);

    await expect(
      service.listOutlets('unpublished-shop', wrongTypToken),
    ).rejects.toThrow(NotFoundException);
  });
});
