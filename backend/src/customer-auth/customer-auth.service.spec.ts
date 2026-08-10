/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment --
 * Standard jest-mock-typing false positive (see CLAUDE.md's backend lint-gap
 * note and auth.service.spec.ts's identical disable) — disabled here rather
 * than adding more instances of the same accepted, documented pattern to
 * the count. */
import * as bcrypt from 'bcryptjs';
import { UnauthorizedException } from '@nestjs/common';
import { CustomerAuthService } from './customer-auth.service';
import type { DatabaseService } from '../database/database.service';
import type { JwtService } from '@nestjs/jwt';
import type { JobsService } from '../jobs/jobs.service';

jest.mock('bcryptjs');
const mockCompare = bcrypt.compare as unknown as jest.Mock;

afterEach(() => {
  jest.clearAllMocks();
});

function fakeCustomer(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    shopId: 1,
    name: 'Jane Shopper',
    phone: '0501234567',
    email: 'jane@shopper.test',
    passwordHash: 'hashed',
    emailVerified: false,
    registeredAt: new Date(),
    createdAt: new Date(),
    failedLoginAttempts: 0,
    lastFailedLoginAt: null,
    ...overrides,
  };
}

function createMockDb() {
  return {
    query: jest.fn(),
    execute: jest.fn().mockResolvedValue({ affectedRows: 1, insertId: 1 }),
    transaction: jest.fn(),
  } as unknown as DatabaseService & { query: jest.Mock; execute: jest.Mock };
}

function createMockJwt() {
  return {
    signAsync: jest.fn().mockResolvedValue('signed-jwt'),
  } as unknown as JwtService;
}

function createMockJobsService() {
  return {
    enqueue: jest.fn().mockResolvedValue({}),
  } as unknown as JobsService;
}

describe('CustomerAuthService.login — progressive lockout', () => {
  it('a correct password succeeds and resets the failed-attempt counter', async () => {
    const customer = fakeCustomer({
      failedLoginAttempts: 2,
      lastFailedLoginAt: new Date(),
    });
    const db = createMockDb();
    db.query
      .mockResolvedValueOnce([{ id: 1, subdomain: 'test-shop' }]) // resolveShop
      .mockResolvedValueOnce([customer]); // customer lookup
    mockCompare.mockResolvedValue(true);

    const service = new CustomerAuthService(
      db,
      createMockJwt(),
      createMockJobsService(),
    );
    await service.login('test-shop', {
      identifier: customer.phone,
      password: 'correct',
    });

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('failedLoginAttempts = 0'),
      [customer.id],
    );
  });

  it('a wrong password below the lockout threshold still runs bcrypt and records the failure', async () => {
    const customer = fakeCustomer({
      failedLoginAttempts: 1,
      lastFailedLoginAt: null,
    });
    const db = createMockDb();
    db.query
      .mockResolvedValueOnce([{ id: 1, subdomain: 'test-shop' }])
      .mockResolvedValueOnce([customer]);
    mockCompare.mockResolvedValue(false);

    const service = new CustomerAuthService(
      db,
      createMockJwt(),
      createMockJobsService(),
    );
    await expect(
      service.login('test-shop', {
        identifier: customer.phone,
        password: 'wrong',
      }),
    ).rejects.toThrow(UnauthorizedException);

    expect(bcrypt.compare).toHaveBeenCalled();
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('failedLoginAttempts = failedLoginAttempts + 1'),
      [expect.any(Date), customer.id],
    );
  });

  it('a nonexistent identifier is rejected without ever touching bcrypt or the customer table', async () => {
    const db = createMockDb();
    db.query
      .mockResolvedValueOnce([{ id: 1, subdomain: 'test-shop' }])
      .mockResolvedValueOnce([]);
    mockCompare.mockClear();

    const service = new CustomerAuthService(
      db,
      createMockJwt(),
      createMockJobsService(),
    );
    await expect(
      service.login('test-shop', {
        identifier: 'nobody@nowhere.test',
        password: 'whatever',
      }),
    ).rejects.toThrow(UnauthorizedException);

    expect(mockCompare).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('a guest-only row (no passwordHash) is rejected without being tracked — nothing to brute-force', async () => {
    const guestRow = fakeCustomer({ passwordHash: null });
    const db = createMockDb();
    db.query
      .mockResolvedValueOnce([{ id: 1, subdomain: 'test-shop' }])
      .mockResolvedValueOnce([guestRow]);
    mockCompare.mockClear();

    const service = new CustomerAuthService(
      db,
      createMockJwt(),
      createMockJobsService(),
    );
    await expect(
      service.login('test-shop', {
        identifier: guestRow.phone,
        password: 'whatever',
      }),
    ).rejects.toThrow(UnauthorizedException);

    expect(mockCompare).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('is rejected during the cooldown window WITHOUT running bcrypt, even with the correct password', async () => {
    const customer = fakeCustomer({
      failedLoginAttempts: 5,
      lastFailedLoginAt: new Date(Date.now() - 500), // 0.5s ago, inside the 2s window
    });
    const db = createMockDb();
    db.query
      .mockResolvedValueOnce([{ id: 1, subdomain: 'test-shop' }])
      .mockResolvedValueOnce([customer]);
    mockCompare.mockClear();
    mockCompare.mockResolvedValue(true); // even the "right" password

    const service = new CustomerAuthService(
      db,
      createMockJwt(),
      createMockJobsService(),
    );
    await expect(
      service.login('test-shop', {
        identifier: customer.phone,
        password: 'correct',
      }),
    ).rejects.toThrow(UnauthorizedException);

    expect(mockCompare).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('succeeds once the cooldown window has actually elapsed', async () => {
    const customer = fakeCustomer({
      failedLoginAttempts: 5,
      lastFailedLoginAt: new Date(Date.now() - 3000), // past the 2s window
    });
    const db = createMockDb();
    db.query
      .mockResolvedValueOnce([{ id: 1, subdomain: 'test-shop' }])
      .mockResolvedValueOnce([customer]);
    mockCompare.mockResolvedValue(true);

    const service = new CustomerAuthService(
      db,
      createMockJwt(),
      createMockJobsService(),
    );
    await service.login('test-shop', {
      identifier: customer.phone,
      password: 'correct',
    });

    expect(bcrypt.compare).toHaveBeenCalled();
  });

  it('the cooldown is capped rather than growing unbounded — a real account is never denied forever', async () => {
    const customer = fakeCustomer({
      failedLoginAttempts: 50,
      lastFailedLoginAt: new Date(Date.now() - 61_000),
    });
    const db = createMockDb();
    db.query
      .mockResolvedValueOnce([{ id: 1, subdomain: 'test-shop' }])
      .mockResolvedValueOnce([customer]);
    mockCompare.mockResolvedValue(true);

    const service = new CustomerAuthService(
      db,
      createMockJwt(),
      createMockJobsService(),
    );
    await service.login('test-shop', {
      identifier: customer.phone,
      password: 'correct',
    });

    expect(bcrypt.compare).toHaveBeenCalled();
  });
});
