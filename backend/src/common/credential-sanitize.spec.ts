import { plainToInstance } from 'class-transformer';
import {
  PLATFORM_CREDENTIAL_ENV,
  SanitizeCredential,
  sanitizeCredentialMap,
  sanitizeCredentialValue,
  sanitizeOptional,
  sanitizePlatformCredentialEnv,
} from './credential-sanitize';

describe('sanitizeCredentialValue', () => {
  it('removes U+2069, U+200E, U+FEFF and surrounding spaces from a Meta id', () => {
    expect(sanitizeCredentialValue('  ﻿1448631878331811⁩‎  ')).toBe(
      '1448631878331811',
    );
  });

  it('removes every listed invisible character and nothing else', () => {
    const invisible = [
      ...Array.from({ length: 5 }, (_, i) => 0x200b + i),
      ...Array.from({ length: 5 }, (_, i) => 0x202a + i),
      ...Array.from({ length: 10 }, (_, i) => 0x2060 + i),
      0xfeff,
      0x00ad,
    ].map((c) => String.fromCharCode(c));
    expect(sanitizeCredentialValue(`a${invisible.join('')}b`)).toBe('ab');
    // Neighbours of the ranges are NOT stripped.
    for (const keep of [' ', '‐', ' ', '⁪', ' ']) {
      expect(sanitizeCredentialValue(`a${keep}b`)).toBe(`a${keep}b`);
    }
  });

  it('leaves a normal value unchanged', () => {
    for (const v of [
      '1448631878331811',
      'EAABwzLixnjYBO_t-0k3n.X',
      'sk_test_51Abc',
      'whsec_YWJjZGVm+/==',
      'G-ABC123XYZ',
    ]) {
      expect(sanitizeCredentialValue(v)).toBe(v);
    }
  });

  it('keeps an inner space (a whitespace check decides about that)', () => {
    expect(sanitizeCredentialValue(' a b ')).toBe('a b');
  });
});

describe('sanitizeCredentialMap / sanitizeOptional', () => {
  it('cleans every string value and keeps non-strings', () => {
    expect(
      sanitizeCredentialMap({ apiKey: 'k⁩', webhookSecret: '​s ', n: 3 }),
    ).toEqual({ apiKey: 'k', webhookSecret: 's', n: 3 });
  });
  it('passes null and undefined through', () => {
    expect(sanitizeOptional(null)).toBeNull();
    expect(sanitizeOptional(undefined)).toBeUndefined();
    expect(sanitizeOptional('x⁩')).toBe('x');
  });
});

describe('SanitizeCredential decorator', () => {
  class Dto {
    @SanitizeCredential()
    id!: string;

    @SanitizeCredential()
    creds!: Record<string, string>;
  }
  it('runs on plainToInstance (before validation)', () => {
    const dto = plainToInstance(Dto, {
      id: '1448631878331811⁩',
      creds: { apiKey: '﻿key ' },
    });
    expect(dto.id).toBe('1448631878331811');
    expect(dto.creds).toEqual({ apiKey: 'key' });
  });
});

describe('sanitizePlatformCredentialEnv', () => {
  it('cleans the platform WhatsApp and gateway credentials in place, and nothing else', () => {
    const env: NodeJS.ProcessEnv = {
      PLATFORM_WHATSAPP_PHONE_NUMBER_ID: '1448631878331811⁩',
      PLATFORM_WHATSAPP_ACCESS_TOKEN: ' tok‎',
      STRIPE_SECRET_KEY: 'sk_test_x﻿',
      JWT_SECRET: 'jwt⁩',
    };
    sanitizePlatformCredentialEnv(env);
    expect(env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID).toBe('1448631878331811');
    expect(env.PLATFORM_WHATSAPP_ACCESS_TOKEN).toBe('tok');
    expect(env.STRIPE_SECRET_KEY).toBe('sk_test_x');
    // Not a provider credential: left exactly as set.
    expect(env.JWT_SECRET).toBe('jwt⁩');
    expect(PLATFORM_CREDENTIAL_ENV).toContain(
      'PLATFORM_WHATSAPP_PHONE_NUMBER_ID',
    );
  });
});
