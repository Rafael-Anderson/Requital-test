import { BadRequestException } from '@nestjs/common';
import { COMMON_PASSWORDS } from './common-passwords';
import {
  checkPasswordRules,
  PasswordPolicyService,
  PASSWORD_MAX_BYTES,
} from './password-policy.service';
import * as breach from './breach-check';

const id = {
  email: 'Fatima.Ali@Example.com',
  name: 'Fatima Ali',
  shopName: 'Rose Garden Florist',
  subdomain: 'rosegarden',
  phone: '+971 50 123 4567',
};

describe('checkPasswordRules', () => {
  it('rejects too short, counting code points', () => {
    expect(checkPasswordRules('abc1234', id)).toBe('too_short');
    expect(checkPasswordRules('😀😀😀😀😀😀😀', id)).toBe('too_short');
    expect(
      checkPasswordRules('😀'.repeat(8), id, { skipCommon: true }),
    ).toBeNull();
  });

  it('rejects by UTF-8 BYTE length, not characters (bcrypt truncates at 72 bytes)', () => {
    const rules = (p: string) =>
      checkPasswordRules(p, id, { skipCommon: true });
    const justFits = 'a'.repeat(PASSWORD_MAX_BYTES);
    expect(rules(justFits)).toBeNull();
    expect(rules(justFits + 'a')).toBe('too_long');
    // 25 emoji = 25 characters but 100 bytes.
    expect(rules('🔐'.repeat(25))).toBe('too_long');
    // 36 two-byte characters = 72 bytes fits, 37 does not.
    expect(rules('é'.repeat(36))).toBeNull();
    expect(rules('é'.repeat(37))).toBe('too_long');
  });

  it('imposes NO composition rules', () => {
    expect(checkPasswordRules('purelylowercasewords', id)).toBeNull();
    expect(checkPasswordRules('12 34 56 78 90 xx', id)).toBeNull();
  });

  it('rejects passwords equal to the email, its local part, the name, shop name, subdomain or phone', () => {
    for (const bad of [
      'fatima.ali@example.com',
      'FATIMA.ALI@EXAMPLE.COM',
      'fatima.ali',
      'Fatima Ali',
      'fatimaali',
      'rose garden florist',
      'RoseGarden',
      '971501234567',
    ]) {
      expect(checkPasswordRules(bad, id)).toBe('matches_identity');
    }
    // containing is not equality
    expect(checkPasswordRules('fatima.ali-has-a-long-one', id)).toBeNull();
  });

  it('rejects common passwords (case and spacing insensitive) and single-character runs', () => {
    expect(checkPasswordRules('Password123', {})).toBe('too_common');
    expect(checkPasswordRules('QWERTY123', {})).toBe('too_common');
    expect(checkPasswordRules('pass word 123', {})).toBe('too_common');
    expect(checkPasswordRules('zzzzzzzzzz', {})).toBe('too_common');
    expect(
      checkPasswordRules('Password123', {}, { skipCommon: true }),
    ).toBeNull();
  });

  it('the offline list is a few hundred entries, all 8+ chars and lowercase', () => {
    expect(COMMON_PASSWORDS.size).toBeGreaterThan(300);
    for (const p of COMMON_PASSWORDS) {
      expect(p.length).toBeGreaterThanOrEqual(8);
      expect(p).toBe(p.toLowerCase());
    }
  });
});

describe('PasswordPolicyService (policy layers enabled for this spec)', () => {
  const svc = new PasswordPolicyService();
  let breached: jest.SpyInstance;
  beforeEach(() => {
    process.env.PASSWORD_POLICY_IN_TESTS = '1';
    breached = jest
      .spyOn(breach, 'isBreachedPassword')
      .mockResolvedValue(false);
  });
  afterEach(() => {
    delete process.env.PASSWORD_POLICY_IN_TESTS;
    jest.restoreAllMocks();
  });

  it('throws a 400 with a stable code per violation', async () => {
    const cases: Array<[string, string]> = [
      ['short1', 'password_too_short'],
      ['x'.repeat(73), 'password_too_long'],
      ['fatima.ali@example.com', 'password_matches_identity'],
      ['password123', 'password_too_common'],
    ];
    for (const [pw, code] of cases) {
      const err = await svc.assertAcceptable(pw, id).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as {
        code: string;
        message: string;
      };
      expect(body.code).toBe(code);
      expect(body.message.length).toBeGreaterThan(10);
    }
  });

  it('a breached password is rejected with its own code', async () => {
    breached.mockResolvedValue(true);
    const err = (await svc
      .assertAcceptable('a-long-unusual-phrase-77', id)
      .catch((e: unknown) => e)) as BadRequestException;
    expect((err.getResponse() as { code: string }).code).toBe(
      'password_breached',
    );
  });

  it('does not call the breach service when a cheaper rule already failed', async () => {
    await svc.assertAcceptable('password123', id).catch(() => undefined);
    expect(breached).not.toHaveBeenCalled();
  });

  it('accepts a decent password', async () => {
    await expect(
      svc.assertAcceptable('a-long-unusual-phrase-77', id),
    ).resolves.toBeUndefined();
  });

  it('under NODE_ENV=test without the seam, the common and breach layers are off', async () => {
    delete process.env.PASSWORD_POLICY_IN_TESTS;
    await expect(
      svc.assertAcceptable('password123', id),
    ).resolves.toBeUndefined();
    expect(breached).not.toHaveBeenCalled();
    await expect(svc.assertAcceptable('short', id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
