import { generateOtp, hashOtp, newOtpSalt, otpMatches } from './otp';

describe('delivery OTP', () => {
  it('is always six digits', () => {
    for (let i = 0; i < 500; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
  });

  it('matches only the right code, stop and salt', () => {
    const salt = newOtpSalt();
    const hash = hashOtp(7, salt, '012345');
    expect(otpMatches(7, salt, '012345', hash)).toBe(true);
    expect(otpMatches(7, salt, '012346', hash)).toBe(false);
    expect(otpMatches(8, salt, '012345', hash)).toBe(false);
    expect(otpMatches(7, newOtpSalt(), '012345', hash)).toBe(false);
  });

  it('does not throw on a malformed stored hash', () => {
    expect(otpMatches(1, newOtpSalt(), '000000', 'zz')).toBe(false);
    expect(otpMatches(1, newOtpSalt(), '000000', '')).toBe(false);
  });
});
