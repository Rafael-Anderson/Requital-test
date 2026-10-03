import { checkPasswordRules } from './password-policy.service';

// Security review repro (STF-5): the offline rules reject 'aaaaaaaa' (single
// repeated character) but squash() strips ALL whitespace before the
// repeated-character and common-list tests, so an all-whitespace password
// squashes to '' and sails past both. With the breach API down (fail open) or
// PASSWORD_BREACH_CHECK=off this is the only layer, and it accepts it.
describe('password policy: whitespace-only password', () => {
  it.each(['        ', '                ', '　　　　　　　　'])(
    'rejects %j (no information content)',
    (pw) => {
      expect(checkPasswordRules(pw, {})).not.toBeNull();
    },
  );
});
