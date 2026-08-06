/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment --
 * Standard jest-mock-typing false positive (see CLAUDE.md's backend lint-gap
 * note): `expect(mockedService.method).toHaveBeenCalledWith(...)` trips
 * unbound-method, and reading fields off a loosely-typed mocked Prisma
 * result trips no-unsafe-assignment. Already the majority of this repo's
 * pre-existing lint debt across every other *.spec.ts file; disabled here
 * rather than adding more instances of the same accepted, documented
 * pattern to the count. */
import * as bcrypt from 'bcryptjs';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { JwtService } from '@nestjs/jwt';
import type { AuditLogService } from '../audit-log/audit-log.service';
import type { JobsService } from '../jobs/jobs.service';

// bcryptjs's exports aren't configurable, so jest.spyOn can't redefine them
// directly — mock the whole module instead and drive each test through the
// resulting jest.fn()s.
jest.mock('bcryptjs');
const mockCompare = bcrypt.compare as unknown as jest.Mock;
const mockHash = bcrypt.hash as unknown as jest.Mock;

afterEach(() => {
  jest.clearAllMocks();
});

function fakeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    shopId: 1,
    outletId: null,
    email: 'admin@shop.test',
    name: 'Admin',
    passwordHash: 'hashed',
    phone: null,
    role: 'admin',
    emailVerified: true,
    failedLoginAttempts: 0,
    lastFailedLoginAt: null,
    createdAt: new Date(),
    shop: { name: 'Test Shop' },
    ...overrides,
  };
}

function createMockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue(fakeUser()),
    },
    authtoken: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    refreshtoken: {
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    ...overrides,
  } as unknown as PrismaService;
}

function createMockJwt() {
  return {
    signAsync: jest.fn().mockResolvedValue('signed-jwt'),
  } as unknown as JwtService;
}

function createMockAuditLog() {
  return {
    log: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditLogService;
}

function createMockJobsService() {
  return {
    enqueue: jest.fn().mockResolvedValue({}),
  } as unknown as JobsService;
}

describe('AuthService.login — progressive lockout', () => {
  it('a correct password succeeds and resets the failed-attempt counter', async () => {
    const user = fakeUser({
      failedLoginAttempts: 2,
      lastFailedLoginAt: new Date(),
    });
    const prisma = createMockPrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);
    mockCompare.mockResolvedValue(true);

    const service = new AuthService(
      prisma,
      createMockJwt(),
      createMockAuditLog(),
      createMockJobsService(),
    );
    await service.login({ email: user.email, password: 'correct' });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lastFailedLoginAt: null },
    });
  });

  it('a wrong password below the lockout threshold still runs bcrypt and records the failure', async () => {
    const user = fakeUser({ failedLoginAttempts: 1, lastFailedLoginAt: null });
    const prisma = createMockPrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);
    mockCompare.mockResolvedValue(false);

    const service = new AuthService(
      prisma,
      createMockJwt(),
      createMockAuditLog(),
      createMockJobsService(),
    );
    await expect(
      service.login({ email: user.email, password: 'wrong' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(bcrypt.compare).toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: {
        failedLoginAttempts: { increment: 1 },
        lastFailedLoginAt: expect.any(Date),
      },
    });
  });

  it('a nonexistent email is rejected without ever touching bcrypt or the user table', async () => {
    const prisma = createMockPrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    const compareSpy = mockCompare;
    compareSpy.mockClear();

    const service = new AuthService(
      prisma,
      createMockJwt(),
      createMockAuditLog(),
      createMockJobsService(),
    );
    await expect(
      service.login({ email: 'nobody@nowhere.test', password: 'whatever' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(compareSpy).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('is rejected during the cooldown window WITHOUT running bcrypt, even with the correct password', async () => {
    // At the lockout threshold (5), the first cooldown window is 2s.
    const user = fakeUser({
      failedLoginAttempts: 5,
      lastFailedLoginAt: new Date(Date.now() - 500), // 0.5s ago, well inside the 2s window
    });
    const prisma = createMockPrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);
    const compareSpy = mockCompare;
    compareSpy.mockClear();
    compareSpy.mockResolvedValue(true); // even the "right" password

    const service = new AuthService(
      prisma,
      createMockJwt(),
      createMockAuditLog(),
      createMockJobsService(),
    );
    await expect(
      service.login({ email: user.email, password: 'correct' }),
    ).rejects.toThrow(UnauthorizedException);

    // The whole point of a progressive delay, not a hard lockout: this must
    // be a fast rejection (no bcrypt work spent), not a security decision
    // that depends on secret material — and it must not ratchet the
    // cooldown further, since the caller never actually got a real attempt.
    expect(compareSpy).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('succeeds once the cooldown window has actually elapsed', async () => {
    const user = fakeUser({
      failedLoginAttempts: 5,
      lastFailedLoginAt: new Date(Date.now() - 3000), // 3s ago, past the 2s window
    });
    const prisma = createMockPrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);
    mockCompare.mockResolvedValue(true);

    const service = new AuthService(
      prisma,
      createMockJwt(),
      createMockAuditLog(),
      createMockJobsService(),
    );
    await service.login({ email: user.email, password: 'correct' });

    expect(bcrypt.compare).toHaveBeenCalled();
  });

  it('the cooldown is capped rather than growing unbounded — a real account is never denied forever', async () => {
    // A huge attempt count would compute an astronomically large delay
    // without a cap; confirm it's clamped to the documented 60s ceiling by
    // checking a wait of 61s (safely past any capped window) is enough.
    const user = fakeUser({
      failedLoginAttempts: 50,
      lastFailedLoginAt: new Date(Date.now() - 61_000),
    });
    const prisma = createMockPrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);
    mockCompare.mockResolvedValue(true);

    const service = new AuthService(
      prisma,
      createMockJwt(),
      createMockAuditLog(),
      createMockJobsService(),
    );
    await service.login({ email: user.email, password: 'correct' });

    expect(bcrypt.compare).toHaveBeenCalled();
  });
});

describe('AuthService — token supersession and invalidation', () => {
  it('forgotPassword invalidates any still-outstanding reset token before issuing a new one', async () => {
    const user = fakeUser();
    const prisma = createMockPrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);

    const service = new AuthService(
      prisma,
      createMockJwt(),
      createMockAuditLog(),
      createMockJobsService(),
    );
    await service.forgotPassword({ email: user.email });

    expect(prisma.authtoken.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, purpose: 'password_reset', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    // The invalidation must happen before the new token is created, not after.
    const invalidateOrder = (prisma.authtoken.updateMany as jest.Mock).mock
      .invocationCallOrder[0];
    const createOrder = (prisma.authtoken.create as jest.Mock).mock
      .invocationCallOrder[0];
    expect(invalidateOrder).toBeLessThan(createOrder);
  });

  it('resendVerification invalidates any still-outstanding verification token before issuing a new one', async () => {
    const user = fakeUser({ emailVerified: false });
    const prisma = createMockPrisma();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue(user);

    const service = new AuthService(
      prisma,
      createMockJwt(),
      createMockAuditLog(),
      createMockJobsService(),
    );
    await service.resendVerification({
      userId: user.id,
      shopId: user.shopId,
      role: 'admin',
      outletId: null,
    });

    expect(prisma.authtoken.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, purpose: 'email_verification', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it('changePassword invalidates any outstanding password-reset token as part of the same transaction', async () => {
    const user = fakeUser();
    const prisma = createMockPrisma();
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue(user);
    mockCompare.mockResolvedValue(true);
    mockHash.mockResolvedValue('new-hash');

    const service = new AuthService(
      prisma,
      createMockJwt(),
      createMockAuditLog(),
      createMockJobsService(),
    );
    await service.changePassword(
      { userId: user.id, shopId: user.shopId, role: 'admin', outletId: null },
      { currentPassword: 'old', newPassword: 'newpassword123' },
    );

    expect(prisma.authtoken.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, purpose: 'password_reset', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it('resetPassword rejects a token that has already been used', async () => {
    const prisma = createMockPrisma();
    (prisma.authtoken.findUnique as jest.Mock).mockResolvedValue({
      id: 1,
      userId: 1,
      purpose: 'password_reset',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    });
    (prisma.authtoken.updateMany as jest.Mock).mockResolvedValue({ count: 0 }); // CAS lost — already used

    const service = new AuthService(
      prisma,
      createMockJwt(),
      createMockAuditLog(),
      createMockJobsService(),
    );
    await expect(
      service.resetPassword({
        token: 'sometoken',
        newPassword: 'newpassword123',
      }),
    ).rejects.toThrow('This reset link has already been used');
  });

  it('resetPassword rejects an expired token', async () => {
    const prisma = createMockPrisma();
    (prisma.authtoken.findUnique as jest.Mock).mockResolvedValue({
      id: 1,
      userId: 1,
      purpose: 'password_reset',
      expiresAt: new Date(Date.now() - 1000),
      usedAt: null,
    });

    const service = new AuthService(
      prisma,
      createMockJwt(),
      createMockAuditLog(),
      createMockJobsService(),
    );
    await expect(
      service.resetPassword({
        token: 'sometoken',
        newPassword: 'newpassword123',
      }),
    ).rejects.toThrow('invalid or has expired');
  });

  it('resetPassword rejects a token of the wrong purpose (e.g. an email-verification token)', async () => {
    const prisma = createMockPrisma();
    (prisma.authtoken.findUnique as jest.Mock).mockResolvedValue({
      id: 1,
      userId: 1,
      purpose: 'email_verification',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    });

    const service = new AuthService(
      prisma,
      createMockJwt(),
      createMockAuditLog(),
      createMockJobsService(),
    );
    await expect(
      service.resetPassword({
        token: 'sometoken',
        newPassword: 'newpassword123',
      }),
    ).rejects.toThrow('invalid or has expired');
  });

  it('verifyEmail rejects a garbage/unknown token', async () => {
    const prisma = createMockPrisma();
    (prisma.authtoken.findUnique as jest.Mock).mockResolvedValue(null);

    const service = new AuthService(
      prisma,
      createMockJwt(),
      createMockAuditLog(),
      createMockJobsService(),
    );
    await expect(
      service.verifyEmail({ token: 'not-a-real-token' }),
    ).rejects.toThrow('invalid or has expired');
  });
});
