import { NotFoundException } from '@nestjs/common';
import { SliderSettingsService } from './slider-settings.service';
import type { DatabaseService } from '../database/database.service';
import type { FeaturesService } from '../features/features.service';

function mockDb(
  row: { sliderEnabled: boolean; sliderAccountId: string | null } | null,
) {
  return {
    query: jest.fn().mockResolvedValue(row ? [row] : []),
    execute: jest.fn().mockResolvedValue({ affectedRows: row ? 1 : 0 }),
  } as unknown as DatabaseService;
}

// The resolved flag is FeaturesService's job (features.service.spec.ts); here it
// just reports the row's own toggle, i.e. the "no override" case.
function svc(
  row: { sliderEnabled: boolean; sliderAccountId: string | null } | null,
) {
  const features = {
    isEnabled: jest.fn().mockResolvedValue(row?.sliderEnabled ?? false),
  } as unknown as FeaturesService;
  return new SliderSettingsService(mockDb(row), features);
}

describe('SliderSettingsService', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('find', () => {
    it('reports not_enabled when the shop has never turned Slider on', async () => {
      const service = svc({ sliderEnabled: false, sliderAccountId: null });
      await expect(service.find({ shopId: 1 } as never)).resolves.toEqual({
        enabled: false,
        accountId: null,
        status: 'not_enabled',
      });
    });

    it('reports awaiting_setup when enabled but no account id yet', async () => {
      const service = svc({ sliderEnabled: true, sliderAccountId: null });
      await expect(service.find({ shopId: 1 } as never)).resolves.toEqual({
        enabled: true,
        accountId: null,
        status: 'awaiting_setup',
      });
    });

    it('reports connected once enabled with an account id', async () => {
      const service = svc({ sliderEnabled: true, sliderAccountId: 'acct_1' });
      await expect(service.find({ shopId: 1 } as never)).resolves.toEqual({
        enabled: true,
        accountId: 'acct_1',
        status: 'connected',
      });
    });

    it('throws NotFoundException for a shop that does not exist', async () => {
      const service = svc(null);
      await expect(service.find({ shopId: 999 } as never)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('resolveCredentials', () => {
    it('returns null when the shop has not enabled Slider', async () => {
      const service = svc({ sliderEnabled: false, sliderAccountId: 'acct_1' });
      process.env.SLIDER_API_KEY = 'sk_platform';
      process.env.SLIDER_ENVIRONMENT = 'sandbox';
      await expect(service.resolveCredentials(1)).resolves.toBeNull();
    });

    it('returns null when enabled but no account id (awaiting setup)', async () => {
      const service = svc({ sliderEnabled: true, sliderAccountId: null });
      process.env.SLIDER_API_KEY = 'sk_platform';
      process.env.SLIDER_ENVIRONMENT = 'sandbox';
      await expect(service.resolveCredentials(1)).resolves.toBeNull();
    });

    it('returns null when the platform env vars are not configured, even for a fully set-up shop', async () => {
      const service = svc({ sliderEnabled: true, sliderAccountId: 'acct_1' });
      delete process.env.SLIDER_API_KEY;
      delete process.env.SLIDER_ENVIRONMENT;
      await expect(service.resolveCredentials(1)).resolves.toBeNull();
    });

    it('resolves real credentials from the platform env vars + the shop account id', async () => {
      const service = svc({ sliderEnabled: true, sliderAccountId: 'acct_1' });
      process.env.SLIDER_API_KEY = 'sk_platform';
      process.env.SLIDER_ENVIRONMENT = 'sandbox';
      await expect(service.resolveCredentials(1)).resolves.toEqual({
        apiKey: 'sk_platform',
        accountId: 'acct_1',
        baseUrl: 'https://api-sandbox.slider-app.com/v1',
      });
    });
  });
});
