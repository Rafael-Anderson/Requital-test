import { PaymentSettingsService } from './payment-settings.service';
import type { DatabaseService } from '../database/database.service';
import type { ShopService } from '../shop/shop.service';

jest.mock('../common/crypto', () => ({
  encrypt: (v: string) => v,
  decrypt: (v: string) => v,
}));

interface MockDb {
  query: jest.Mock;
}

function createMockDb(rows: { provider: string; enabled: boolean; credentials: string | null }[]): DatabaseService & MockDb {
  const query = jest.fn().mockImplementation((sql: string) => {
    if (sql.includes('SELECT credentials FROM shoppaymentprovider')) {
      const row = rows.find((r) => r.provider === 'tabby');
      return Promise.resolve([{ credentials: row?.credentials ?? null }]);
    }
    // isEnabled's "SELECT * FROM shoppaymentprovider WHERE shopId = ?"
    return Promise.resolve(rows);
  });
  return { query } as unknown as DatabaseService & MockDb;
}

const mockShopService = {} as ShopService;

describe('PaymentSettingsService.resolveTabbyMerchantCode', () => {
  const oldEnv = process.env.TABBY_PUBLIC_KEY;
  afterEach(() => {
    process.env.TABBY_PUBLIC_KEY = oldEnv;
  });

  it('returns null when Tabby is not enabled for the shop', async () => {
    const db = createMockDb([{ provider: 'tabby', enabled: false, credentials: JSON.stringify({ merchantCode: 'mc_1' }) }]);
    const service = new PaymentSettingsService(db, mockShopService);

    expect(await service.resolveTabbyMerchantCode(1)).toBeNull();
  });

  it('returns the stored merchantCode when set', async () => {
    const db = createMockDb([
      { provider: 'tabby', enabled: true, credentials: JSON.stringify({ publicKey: 'pk_1', merchantCode: 'mc_1' }) },
    ]);
    const service = new PaymentSettingsService(db, mockShopService);

    expect(await service.resolveTabbyMerchantCode(1)).toBe('mc_1');
  });

  it('falls back to publicKey when merchantCode is not set', async () => {
    const db = createMockDb([{ provider: 'tabby', enabled: true, credentials: JSON.stringify({ publicKey: 'pk_1' }) }]);
    const service = new PaymentSettingsService(db, mockShopService);

    expect(await service.resolveTabbyMerchantCode(1)).toBe('pk_1');
  });

  it('falls back to the platform TABBY_PUBLIC_KEY env var when the shop has no credentials at all', async () => {
    process.env.TABBY_PUBLIC_KEY = 'pk_platform';
    const db = createMockDb([{ provider: 'tabby', enabled: true, credentials: null }]);
    const service = new PaymentSettingsService(db, mockShopService);

    expect(await service.resolveTabbyMerchantCode(1)).toBe('pk_platform');
  });

  it('returns null when nothing is configured anywhere', async () => {
    delete process.env.TABBY_PUBLIC_KEY;
    const db = createMockDb([{ provider: 'tabby', enabled: true, credentials: null }]);
    const service = new PaymentSettingsService(db, mockShopService);

    expect(await service.resolveTabbyMerchantCode(1)).toBeNull();
  });
});
