import { credentialProblem, credentialProblems } from './credential-validation';

const GOOD_WHSEC = 'whsec_c2VjcmV0LXNpZ25pbmcta2V5';

describe('credential validation', () => {
  describe('nomod', () => {
    it('accepts a plain API key and a decodable whsec_ secret', () => {
      expect(credentialProblem('nomod', 'apiKey', 'sk_abc123XYZ')).toBeNull();
      expect(
        credentialProblem('nomod', 'webhookSecret', GOOD_WHSEC),
      ).toBeNull();
      // The whsec_ prefix is optional, as in decodeSecret.
      expect(
        credentialProblem('nomod', 'webhookSecret', 'c2VjcmV0LXNpZ25pbmcta2V5'),
      ).toBeNull();
    });

    it('rejects a webhook URL pasted into the API key, naming the field', () => {
      const p = credentialProblem(
        'nomod',
        'apiKey',
        'https://api.requital.io/payments/webhook/nomod/abc',
      );
      expect(p).toBe(
        'This looks like a webhook URL. Paste the API key from your Nomod dashboard instead.',
      );
      expect(
        credentialProblem('nomod', 'apiKey', 'HTTP://example.com'),
      ).toMatch(/webhook URL/);
    });

    it('rejects a webhook URL pasted into the signing secret', () => {
      expect(
        credentialProblem(
          'nomod',
          'webhookSecret',
          'https://api.requital.io/payments/webhook/nomod/abc',
        ),
      ).toMatch(/Paste the webhook signing secret/);
    });

    it('rejects whitespace inside a value, but trims the ends', () => {
      expect(credentialProblem('nomod', 'apiKey', 'abc def')).toMatch(
        /cannot contain spaces/,
      );
      expect(credentialProblem('nomod', 'apiKey', 'abc\tdef')).toMatch(
        /cannot contain spaces/,
      );
      expect(credentialProblem('nomod', 'apiKey', '  abcdef \n')).toBeNull();
    });

    it('rejects a signing secret that does not decode', () => {
      expect(credentialProblem('nomod', 'webhookSecret', 'whsec_x')).toMatch(
        /signing secret is not valid/,
      );
      expect(
        credentialProblem('nomod', 'webhookSecret', 'whsec_not*base64!'),
      ).toMatch(/not valid/);
    });

    it('leaves the plain settings (baseUrl) alone', () => {
      expect(
        credentialProblem('nomod', 'baseUrl', 'https://api.nomod.com'),
      ).toBeNull();
    });
  });

  describe('stripe', () => {
    it.each(['sk_live_abc', 'sk_test_abc', 'rk_live_abc', 'rk_test_abc'])(
      'accepts a secret key starting %s',
      (k) => {
        expect(credentialProblem('stripe', 'secretKey', k)).toBeNull();
      },
    );

    it('rejects a publishable key or anything else as the secret key', () => {
      expect(credentialProblem('stripe', 'secretKey', 'pk_live_abc')).toMatch(
        /must start with sk_live_, sk_test_, rk_live_ or rk_test_/,
      );
      expect(credentialProblem('stripe', 'secretKey', 'whsec_abc')).toMatch(
        /must start with sk_live_/,
      );
    });

    it('requires whsec_ on the webhook secret', () => {
      expect(
        credentialProblem('stripe', 'webhookSecret', 'whsec_abc'),
      ).toBeNull();
      expect(credentialProblem('stripe', 'webhookSecret', 'sk_live_x')).toMatch(
        /must start with whsec_/,
      );
    });

    it('rejects URLs and whitespace before the prefix rules', () => {
      expect(
        credentialProblem('stripe', 'secretKey', 'https://x.test/hook'),
      ).toBe(
        'This looks like a webhook URL. Paste the secret key from your Stripe dashboard instead.',
      );
      expect(credentialProblem('stripe', 'webhookSecret', 'whsec_a b')).toMatch(
        /cannot contain spaces/,
      );
    });
  });

  it('does not judge other providers or blank values', () => {
    expect(credentialProblem('tabby', 'secretKey', 'https://x')).toBeNull();
    expect(credentialProblem('nomod', 'apiKey', '   ')).toBeNull();
  });

  it('collects every problem by field', () => {
    expect(
      credentialProblems('nomod', {
        apiKey: 'https://a.test/x',
        webhookSecret: 'https://a.test/y',
      }),
    ).toEqual({
      apiKey:
        'This looks like a webhook URL. Paste the API key from your Nomod dashboard instead.',
      webhookSecret:
        'This looks like a webhook URL. Paste the webhook signing secret from your Nomod dashboard instead.',
    });
  });
});
