import { createHash } from 'crypto';
import {
  buildMetaPurchaseEvent,
  conversionValue,
  hashedEmail,
  hashedPhone,
  purchaseEventId,
  sha256Hex,
} from './meta-capi';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('Meta CAPI hashing', () => {
  it('normalises an email (trim, lower-case) before SHA-256', () => {
    expect(hashedEmail('  Jane.Doe@Example.COM ')).toBe(sha('jane.doe@example.com'));
    expect(hashedEmail('not-an-email')).toBeNull();
    expect(hashedEmail(null)).toBeNull();
    expect(hashedEmail('')).toBeNull();
  });

  it('normalises a phone to country-code digits only before SHA-256', () => {
    expect(hashedPhone('050 123 4567')).toBe(sha('971501234567'));
    expect(hashedPhone('+971-50-123-4567')).toBe(sha('971501234567'));
    expect(hashedPhone('abc')).toBeNull();
    expect(hashedPhone(undefined)).toBeNull();
  });

  it('sha256Hex is lower-case 64-char hex', () => {
    expect(sha256Hex('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('buildMetaPurchaseEvent', () => {
  const base = {
    eventId: purchaseEventId(42),
    eventTimeSeconds: 1_790_000_000,
    value: '31.515',
    currency: 'KWD',
    orderId: 42,
    customerEmail: 'Jane@Example.com',
    customerPhone: '0501234567',
    items: [
      { productId: 7, quantity: 3, unitPrice: '10.505' },
      { productId: 9, quantity: 1, unitPrice: '2' },
    ],
    eventSourceUrl: 'https://shop.requital.io/orders/42',
  };

  it('never contains a raw email or phone anywhere in the serialised event', () => {
    const text = JSON.stringify(
      buildMetaPurchaseEvent({ ...base, attribution: null }),
    );
    expect(text).not.toMatch(/jane@example/i);
    expect(text).not.toContain('0501234567');
    expect(text).not.toContain('971501234567');
    expect(text).toContain(sha('jane@example.com'));
    expect(text).toContain(sha('971501234567'));
  });

  it('uses the shared event id and keeps the third KWD decimal in value', () => {
    const e = buildMetaPurchaseEvent({ ...base, attribution: null });
    expect(e.event_id).toBe('order_42');
    expect(e.custom_data.value).toBe(31.515);
    expect(e.custom_data.currency).toBe('KWD');
    expect(e.custom_data.num_items).toBe(4);
  });

  it('includes fbp/fbc/user agent only when attribution carries them', () => {
    const without = buildMetaPurchaseEvent({ ...base, attribution: null });
    expect(without.user_data).not.toHaveProperty('fbp');
    expect(without.user_data).not.toHaveProperty('fbc');
    expect(without.user_data).not.toHaveProperty('client_user_agent');
    const withIds = buildMetaPurchaseEvent({
      ...base,
      attribution: {
        v: 1,
        consent: { marketing: true },
        fbp: 'fb.1.1.2',
        fbc: 'fb.1.1.abc',
        clientUserAgent: 'UA',
      },
    });
    expect(withIds.user_data).toMatchObject({
      fbp: 'fb.1.1.2',
      fbc: 'fb.1.1.abc',
      client_user_agent: 'UA',
    });
  });

  it('conversionValue honours the currency minor unit (KWD 3dp, AED 2dp)', () => {
    expect(conversionValue('31.515', 'KWD')).toBe('31.515');
    expect(conversionValue('31.515000000', 'AED')).toBe('31.52');
  });
});
