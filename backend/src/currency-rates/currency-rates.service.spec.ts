import { CurrencyRatesService } from './currency-rates.service';
import { PLATFORM_BASE_CURRENCY } from './currency-rates.constants';
import type { DatabaseService } from '../database/database.service';

function mockDb(rows: Record<string, unknown>[]) {
  const query = jest.fn().mockResolvedValue(rows);
  const execute = jest.fn().mockResolvedValue({ affectedRows: 1 });
  return {
    db: { query, execute } as unknown as DatabaseService,
    query,
    execute,
  };
}

describe('CurrencyRatesService.resolveForCapture', () => {
  it('returns the stored rate against the platform base', async () => {
    const { db, query } = mockDb([{ rate: '3.6725000000' }]);
    const service = new CurrencyRatesService(db);

    const captured = await service.resolveForCapture('AED');

    expect(captured).toEqual({
      rateBaseCurrency: PLATFORM_BASE_CURRENCY,
      exchangeRate: '3.6725000000',
    });
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      PLATFORM_BASE_CURRENCY,
      'AED',
    ]);
  });

  it('normalises the currency code before looking it up', async () => {
    const { db, query } = mockDb([{ rate: '3.7500000000' }]);
    const service = new CurrencyRatesService(db);

    await service.resolveForCapture('  sar ');

    expect(query).toHaveBeenCalledWith(expect.any(String), [
      PLATFORM_BASE_CURRENCY,
      'SAR',
    ]);
  });

  // The single most important behaviour in this file. A missing rate must NOT
  // become 1: an order stored with exchangeRate = 1 reads forever after as
  // "this order was at parity with USD", which is a silent, plausible,
  // permanently wrong number. NULL reads as "we never captured this", which is
  // true. And it must not throw, because a reporting figure has no business
  // failing a real customer's checkout.
  it('returns null — never a fallback of 1, never a throw — when no rate is stored', async () => {
    const { db } = mockDb([]);
    const service = new CurrencyRatesService(db);

    await expect(service.resolveForCapture('XYZ')).resolves.toBeNull();
  });

  it('reads on the caller transaction connection when given one', async () => {
    const { db, query: poolQuery } = mockDb([{ rate: '1.0' }]);
    const service = new CurrencyRatesService(db);
    const connQuery = jest.fn().mockResolvedValue([[{ rate: '0.3070000000' }]]);
    const conn = { query: connQuery } as never;

    const captured = await service.resolveForCapture('KWD', conn);

    // Reading on the transaction's own connection is what stops a platform
    // admin's rate edit from landing between the read and the insert.
    expect(captured?.exchangeRate).toBe('0.3070000000');
    expect(connQuery).toHaveBeenCalledTimes(1);
    expect(poolQuery).not.toHaveBeenCalled();
  });
});

describe('CurrencyRatesService.setRate', () => {
  it('upserts against the platform base and records who changed it', async () => {
    const { db, execute } = mockDb([
      {
        baseCurrency: 'USD',
        quoteCurrency: 'KWD',
        rate: '0.3080000000',
        updatedAt: new Date(),
        updatedByPlatformAdminId: 7,
      },
    ]);
    const service = new CurrencyRatesService(db);

    const row = await service.setRate('kwd', 0.308, 7);

    expect(row.quoteCurrency).toBe('KWD');
    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(params[0]).toBe(PLATFORM_BASE_CURRENCY);
    expect(params[1]).toBe('KWD'); // uppercased
    expect(params[4]).toBe(7);
  });
});
