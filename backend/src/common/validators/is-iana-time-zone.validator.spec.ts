import 'reflect-metadata';
import { validate } from 'class-validator';
import { UpdateShopDto } from '../../shop/dto/update-shop.dto';
import { isValidTimeZone } from './is-iana-time-zone.validator';

describe('isValidTimeZone', () => {
  it.each(['Asia/Dubai', 'Asia/Riyadh', 'Asia/Kuwait', 'Europe/London', 'UTC'])(
    'accepts %s',
    (z) => expect(isValidTimeZone(z)).toBe(true),
  );
  it.each(['', '  ', 'Dubai', 'Not/AZone', 'GST', 'Asia/Dubai; DROP', 5, null])(
    'rejects %p',
    (z) => expect(isValidTimeZone(z)).toBe(false),
  );
});

describe('UpdateShopDto.timezone', () => {
  const check = async (timezone: unknown) =>
    (await validate(Object.assign(new UpdateShopDto(), { timezone }))).filter(
      (e) => e.property === 'timezone',
    );

  it('accepts a real zone and an omitted one (partial update)', async () => {
    expect(await check('Asia/Dubai')).toHaveLength(0);
    expect(await check(undefined)).toHaveLength(0);
  });
  it('refuses a name the runtime does not know', async () => {
    const errors = await check('Not/AZone');
    expect(errors).toHaveLength(1);
    expect(Object.values(errors[0].constraints ?? {})[0]).toMatch(/IANA/);
  });
});
