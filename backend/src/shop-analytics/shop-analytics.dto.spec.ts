import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAnalyticsSettingsDto } from './dto/update-analytics-settings.dto';

async function errorsFor(input: Record<string, unknown>) {
  const errors = await validate(plainToInstance(UpdateAnalyticsSettingsDto, input));
  return errors.map((e) => e.property);
}

describe('UpdateAnalyticsSettingsDto id formats', () => {
  it('accepts well-formed ids and explicit nulls (clear)', async () => {
    expect(
      await errorsFor({
        ga4MeasurementId: 'G-ABC123XYZ9',
        metaPixelId: '123456789012345',
        metaCapiToken: 'EAAB' + 'x'.repeat(40),
        metaTestEventCode: 'TEST12345',
        tiktokPixelId: 'C4A1B2C3D4E5F6G7H8I9',
        snapPixelId: '1b2c3d4e-0000-4000-8000-123456789abc',
        googleAdsConversionId: 'AW-123456789',
        googleAdsConversionLabel: 'AbC_dEf-123',
      }),
    ).toEqual([]);
    expect(await errorsFor({ ga4MeasurementId: null, metaCapiToken: null })).toEqual([]);
  });

  it.each([
    ['ga4MeasurementId', '"><script>alert(1)</script>'],
    ['ga4MeasurementId', 'UA-123'],
    ['metaPixelId', "123'; alert(1);//"],
    ['metaPixelId', '12'],
    ['tiktokPixelId', 'abc def'],
    ['snapPixelId', 'not-a-uuid'],
    ['googleAdsConversionId', 'AW-<x>'],
    ['googleAdsConversionLabel', 'a b'],
    ['metaCapiToken', 'short'],
    ['metaCapiToken', 'has space in it which is long enough to pass length'],
    ['metaTestEventCode', 'abc'],
    ['ga4MeasurementId', ''],
  ])('rejects %s = %j', async (field, value) => {
    expect(await errorsFor({ [field]: value })).toContain(field);
  });
});
