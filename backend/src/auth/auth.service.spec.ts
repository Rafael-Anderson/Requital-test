/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment --
 * Standard jest-mock-typing false positive (see CLAUDE.md's backend lint-gap
 * note): `expect(mockedService.method).toHaveBeenCalledWith(...)` trips
 * unbound-method, and reading fields off a loosely-typed mocked DB row
 * result trips no-unsafe-assignment. Already the majority of this repo's
 * pre-existing lint debt across every other *.spec.ts file; disabled here
 * rather than adding more instances of the same accepted, documented
 * pattern to the count. */
import * as bcrypt from 'bcryptjs';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { DatabaseService } from '../database/database.service';
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

// Flat row shape as it comes back from the user JOIN query (shopName/
// outletJoinId/outletName merged in) — see AuthService.rowToUser.
function fakeUserRow(overrides: Record<string, unknown> = {}) {
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
    shopName: 'Test Shop',
    outletJoinId: null,
    outletName: null,
    ...overrides,
  };
}

function createMockDb() {
  const conn = { query: jest.fn().mockResolvedValue([{}]) };
  return {
    query: jest.fn().mockResolvedValue([]),
    execute: jest.fn().mockResolvedValue({ affectedRows: 1, insertId: 1 }),
    transaction: jest.fn((fn: (c: typeof conn) => Promise<unknown>) => fn(conn)),
    pool: {},
    _conn: conn,
  } as unknown as DatabaseService & {
    query: jest.Mock;
    execute: jest.Mock;
    transaction: jest.Mock;
    _conn: { query: jest.Mock };
  };
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
    const user = fakeUserRow({
      failedLoginAttempts: 2,
      lastFailedLoginAt: new Date(),
    });
    const db = createMockDb();
    db.query.mockResolvedValue([user]);
    mockCompare.mockResolvedValue(true);

    const service = new AuthService(
      db,
      createMockJwt(),
      createMockAuditLog(),
      createMockJobsService(),
    );
    await service.login({ email: user.email, password: 'correct' });

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('failedLoginAttempts = 0'),
      [user.id],
    );
  });

  it('a wrong password below the lockout threshold still runs bcrypt and records the failure', async () => {
    const user = fakeUserRow({ failedLoginAttempts: 1, lastFailedLoginAt: null });
    const db = createMockDb();
    db.query.mockResolvedValue([user]);
    mockCompare.mockResolvedValue(false);

    const service = new AuthService(
      db,
      createMockJwt(),
      createMockAuditLog(),
      createMockJobsService(),
    );
    await expect(
      service.login({ email: user.email, password: 'wrong' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(bcrypt.compare).toHaveBeenCalled();
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('failedLoginAttempts = failedLoginAttempts + 1'),
      [expect.any(Date), user.id],
    );
  });

  it('a nonexistent email is rejected without ever touching bcrypt or the user table', async () => {
    const db = createMockDb();
    db.query.mockResolvedValue([]);
    const compareSpy = mockCompare;
    compareSpy.mockClear();

    const service = new AuthService(
      db,
      createMockJwt(),
      createMockAuditLog(),
      createMockJobsService(),
    );
    await expect(
      service.login({ email: 'nobody@nowhere.test', password: 'whatever' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(compareSpy).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('is rejected during the cooldown window WITHOUT running bcrypt, even with the correct password', async () => {
    // At the lockout threshold (5), the first cooldown window is 2s.
    const user = fakeUserRow({
      failedLoginAttempts: 5,
      lastFailedLoginAt: new Date(Date.now() - 500), // 0.5s ago, well inside the 2s window
    });
    const db = createMockDb();
    db.query.mockResolvedValue([user]);
    const compareSpy = mockCompare;
    compareSpy.mockClear();
    compareSpy.mockResolvedValue(true); // even the "right" password

    const service = new AuthService(
      db,
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
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('succeeds once the cooldown window has actually elapsed', async () => {
    const user = fakeUserRow({
      failedLoginAttempts: 5,
      lastFailedLoginAt: new Date(Date.now() - 3000), // 3s ago, past the 2s window
    });
    const db = createMockDb();
    db.query.mockResolvedValue([user]);
    mockCompare.mockResolvedValue(true);

    const service = new AuthService(
      db,
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
    const user = fakeUserRow({
      failedLoginAttempts: 50,
      lastFailedLoginAt: new Date(Date.now() - 61_000),
    });
    const db = createMockDb();
    db.query.mockResolvedValue([user]);
    mockCompare.mockResolvedValue(true);

    const service = new AuthService(
      db,
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
    const user = fakeUserRow();
    const db = createMockDb();
    db.query.mockResolvedValue([user]);

    const service = new AuthService(
      db,
      createMockJwt(),
      createMockAuditLog(),
      createMockJobsService(),
    );
    await service.forgotPassword({ email: user.email });

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("purpose = ? AND usedAt IS NULL"),
      [expect.any(Date), user.id, 'password_reset'],
    );
    // The invalidation must happen before the new token is created, not after.
    const invalidateIndex = db.execute.mock.calls.findIndex(([sql]: [string]) =>
      sql.includes('UPDATE authtoken SET usedAt'),
    );
    const createIndex = db.execute.mock.calls.findIndex(([sql]: [string]) =>
      sql.includes('INSERT INTO authtoken'),
    );
    expect(invalidateIndex).toBeLessThan(createIndex);
  });

  it('resendVerification invalidates any still-outstanding verification token before issuing a new one', async () => {
    const user = fakeUserRow({ emailVerified: false });
    const db = createMockDb();
    db.query.mockResolvedValue([user]);

    const service = new AuthService(
      db,
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

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("purpose = ? AND usedAt IS NULL"),
      [expect.any(Date), user.id, 'email_verification'],
    );
  });

  it('changePassword invalidates any outstanding password-reset token as part of the same transaction', async () => {
    const user = fakeUserRow();
    const db = createMockDb();
    db.query.mockResolvedValue([user]);
    mockCompare.mockResolvedValue(true);
    mockHash.mockResolvedValue('new-hash');

    const service = new AuthService(
      db,
      createMockJwt(),
      createMockAuditLog(),
      createMockJobsService(),
    );
    await service.changePassword(
      { userId: user.id, shopId: user.shopId, role: 'admin', outletId: null },
      { currentPassword: 'old', newPassword: 'newpassword123' },
    );

    expect(db.transaction).toHaveBeenCalled();
    expect(db._conn.query).toHaveBeenCalledWith(
      expect.stringContaining("purpose = 'password_reset'"),
      [expect.any(Date), user.id],
    );
  });

  it('resetPassword rejects a token that has already been used', async () => {
    const db = createMockDb();
    db.query.mockResolvedValue([
      {
        id: 1,
        userId: 1,
        purpose: 'password_reset',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      },
    ]);
    db.execute.mockResolvedValue({ affectedRows: 0 }); // CAS lost — already used

    const service = new AuthService(
      db,
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
    const db = createMockDb();
    db.query.mockResolvedValue([
      {
        id: 1,
        userId: 1,
        purpose: 'password_reset',
        expiresAt: new Date(Date.now() - 1000),
        usedAt: null,
      },
    ]);

    const service = new AuthService(
      db,
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
    const db = createMockDb();
    db.query.mockResolvedValue([
      {
        id: 1,
        userId: 1,
        purpose: 'email_verification',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      },
    ]);

    const service = new AuthService(
      db,
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
    const db = createMockDb();
    db.query.mockResolvedValue([]);

    const service = new AuthService(
      db,
      createMockJwt(),
      createMockAuditLog(),
      createMockJobsService(),
    );
    await expect(
      service.verifyEmail({ token: 'not-a-real-token' }),
    ).rejects.toThrow('invalid or has expired');
  });
});
