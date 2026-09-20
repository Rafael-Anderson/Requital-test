import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { VerifiedEmailGuard } from './verified-email.guard';
import { REQUIRES_VERIFIED_EMAIL_KEY } from '../decorators/requires-verified-email.decorator';
import type { DatabaseService } from '../../database/database.service';

function contextFor(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe('VerifiedEmailGuard', () => {
  let query: jest.Mock;
  let db: DatabaseService;
  let reflector: Reflector;
  let guard: VerifiedEmailGuard;

  beforeEach(() => {
    query = jest.fn();
    db = { query } as unknown as DatabaseService;
    reflector = new Reflector();
    guard = new VerifiedEmailGuard(reflector, db);
  });

  const withMetadata = (options: unknown) => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(options);
  };

  it('lets an undecorated route through without touching the database', async () => {
    withMetadata(undefined);
    await expect(
      guard.canActivate(contextFor({ user: { userId: 1 } })),
    ).resolves.toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it('allows a verified user', async () => {
    withMetadata({ action: 'doing the thing' });
    query.mockResolvedValue([{ emailVerified: 1 }]);
    await expect(
      guard.canActivate(contextFor({ user: { userId: 7 } })),
    ).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('emailVerified'),
      [7],
    );
  });

  it('blocks an unverified user with the action named in the message', async () => {
    withMetadata({ action: 'connecting a payment gateway' });
    query.mockResolvedValue([{ emailVerified: 0 }]);
    await expect(
      guard.canActivate(contextFor({ user: { userId: 7 } })),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      guard.canActivate(contextFor({ user: { userId: 7 } })),
    ).rejects.toThrow(/connecting a payment gateway/);
  });

  // Fail closed: a missing row must not read as "verified".
  it('blocks when the user row has gone', async () => {
    withMetadata({ action: 'doing the thing' });
    query.mockResolvedValue([]);
    await expect(
      guard.canActivate(contextFor({ user: { userId: 7 } })),
    ).rejects.toThrow(ForbiddenException);
  });

  // AuthGuard owns rejecting unauthenticated requests; this guard must not
  // turn a would-be 401 into a confusing 403.
  it('defers to AuthGuard when there is no tenant context', async () => {
    withMetadata({ action: 'doing the thing' });
    await expect(guard.canActivate(contextFor({}))).resolves.toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  describe('whenBodyType', () => {
    it('skips the check when the body type does not match', async () => {
      withMetadata({
        action: 'connecting a custom domain',
        whenBodyType: 'custom',
      });
      await expect(
        guard.canActivate(
          contextFor({ user: { userId: 7 }, body: { type: 'subdomain' } }),
        ),
      ).resolves.toBe(true);
      expect(query).not.toHaveBeenCalled();
    });

    it('enforces the check when it does match', async () => {
      withMetadata({
        action: 'connecting a custom domain',
        whenBodyType: 'custom',
      });
      query.mockResolvedValue([{ emailVerified: 0 }]);
      await expect(
        guard.canActivate(
          contextFor({ user: { userId: 7 }, body: { type: 'custom' } }),
        ),
      ).rejects.toThrow(/connecting a custom domain/);
    });

    it('skips rather than throwing when there is no body at all', async () => {
      withMetadata({
        action: 'connecting a custom domain',
        whenBodyType: 'custom',
      });
      await expect(
        guard.canActivate(contextFor({ user: { userId: 7 } })),
      ).resolves.toBe(true);
    });
  });

  it('reads the metadata key the decorator writes', () => {
    const spy = jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(undefined);
    void guard.canActivate(contextFor({}));
    expect(spy).toHaveBeenCalledWith(
      REQUIRES_VERIFIED_EMAIL_KEY,
      expect.anything(),
    );
  });
});
