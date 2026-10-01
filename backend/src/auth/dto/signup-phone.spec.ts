import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { SignupDto } from './signup.dto';

// The signup phone is read in the dial code of the country picked in the same
// form. AE, "Other" and no country at all must stay on the legacy +971.
describe('SignupDto phone normalisation by country', () => {
  const phoneFor = (country: string | undefined, phone: string) =>
    plainToInstance(SignupDto, { country, phone }).phone;

  it.each([
    ['United Arab Emirates', '0501234567', '+971501234567'],
    [undefined, '0501234567', '+971501234567'],
    ['Other', '0501234567', '+971501234567'],
    ['constructor', '0501234567', '+971501234567'],
    ['Saudi Arabia', '0551234567', '+966551234567'],
    ['Kuwait', '50012345', '+96550012345'],
    ['Saudi Arabia', '+971501234567', '+971501234567'],
  ])('country %s: %s -> %s', (country, raw, expected) => {
    expect(phoneFor(country, raw)).toBe(expected);
  });

  it('leaves an unparseable value as typed so validation still rejects it', () => {
    expect(phoneFor('Saudi Arabia', 'not-a-phone')).toBe('not-a-phone');
  });
});
