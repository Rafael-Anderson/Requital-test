import { isValidCustomDomain } from './domain-validation';

describe('isValidCustomDomain', () => {
  const valid = [
    'example.com',
    'shop.example.com',
    'my-shop.example.co.uk',
    'a.b.example.com',
    'xn--80akhbyknj4f.com', // punycode label
  ];
  const invalid = [
    '',
    'example',
    '-example.com',
    'example-.com',
    'example..com',
    'example.com/',
    'http://example.com',
    'https://example.com',
    'example.com/path',
    'example .com',
    'a'.repeat(64) + '.com', // label over 63 chars
    'a'.repeat(250) + '.com', // over 253 chars total
  ];

  it.each(valid)('accepts %s', (domain) => {
    expect(isValidCustomDomain(domain)).toBe(true);
  });

  it.each(invalid)('rejects %s', (domain) => {
    expect(isValidCustomDomain(domain)).toBe(false);
  });
});
