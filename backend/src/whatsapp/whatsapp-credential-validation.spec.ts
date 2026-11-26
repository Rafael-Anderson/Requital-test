import { whatsappCredentialProblems } from './whatsapp-credential-validation';

describe('whatsappCredentialProblems', () => {
  it('accepts a digits-only id (after removing a pasted U+2069) and a clean token', () => {
    expect(
      whatsappCredentialProblems({
        phoneNumberId: ' 1448631878331811⁩',
        accessToken: '﻿EAABtoken123',
      }),
    ).toEqual({});
  });

  it('rejects a Phone Number ID that is not 10 to 20 digits, naming the field', () => {
    for (const id of [
      '+971501234567',
      '14486 31878',
      '123456789',
      '1'.repeat(21),
      'abc1234567',
    ]) {
      expect(
        whatsappCredentialProblems({ phoneNumberId: id, accessToken: 'EAAB' })
          .phoneNumberId,
      ).toMatch(/Phone Number ID/);
    }
  });

  it('rejects whitespace inside the token, naming the field', () => {
    expect(
      whatsappCredentialProblems({
        phoneNumberId: '1448631878331811',
        accessToken: 'EAAB tok\nen',
      }).accessToken,
    ).toMatch(/access token/);
  });

  it('a blank field is its own problem', () => {
    expect(
      whatsappCredentialProblems({ phoneNumberId: '⁩', accessToken: '' }),
    ).toEqual({
      phoneNumberId: 'Enter the Phone Number ID.',
      accessToken: 'Enter the access token.',
    });
  });
});
