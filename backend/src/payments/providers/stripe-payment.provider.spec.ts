import { StripePaymentProvider } from './stripe-payment.provider';

// The SDK is mocked so the assertion can be made against the exact object
// handed to Stripe. Testing toMinorUnits alone would prove the helper is right
// without proving the provider actually calls it, which is the regression that
// matters here.
const createSession = jest.fn();
const createRefund = jest.fn();
jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create: createSession } },
    refunds: { create: createRefund },
  })),
);

interface SessionBody {
  line_items: { price_data: { currency: string; unit_amount: number } }[];
}

describe('StripePaymentProvider amount serialisation', () => {
  beforeEach(() => {
    createSession.mockReset();
    createSession.mockResolvedValue({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/pay/cs_test_123',
    });
  });

  async function checkout(amount: number, currency: string) {
    const provider = new StripePaymentProvider();
    await provider.createCheckoutSession({
      orderId: 1,
      amount,
      currency,
      successUrl: 'https://shop.example/success',
      cancelUrl: 'https://shop.example/cancel',
      credentials: { secretKey: `sk_test_${currency}` },
    });
    // Typed once here rather than at the access, so the assertions below read
    // as ordinary property access instead of a chain of casts.
    const calls = createSession.mock.calls as unknown as SessionBody[][];
    return calls[0][0].line_items[0].price_data;
  }

  // The only path reachable today: UpdateShopDto locks shop.currency to AED.
  it('sends a two-decimal currency in hundredths', async () => {
    const priceData = await checkout(199.99, 'AED');
    expect(priceData.unit_amount).toBe(19999);
    expect(priceData.currency).toBe('aed');
  });

  // Not reachable while the currency lock stands, and fixed anyway: the old
  // code multiplied by 100 unconditionally, so this would have been submitted
  // as 1050 minor units - 1.050 KWD instead of 10.500, a 10x undercharge.
  it('sends a three-decimal currency in thousandths, not hundredths', async () => {
    const priceData = await checkout(10.5, 'KWD');
    expect(priceData.unit_amount).toBe(10500);
    expect(priceData.unit_amount).not.toBe(1050);
    expect(priceData.currency).toBe('kwd');
  });

  it('applies the three-decimal factor to BHD and OMR too', async () => {
    expect((await checkout(10.5, 'BHD')).unit_amount).toBe(10500);
    createSession.mockClear();
    expect((await checkout(10.5, 'OMR')).unit_amount).toBe(10500);
  });

  it('always sends an integer amount', async () => {
    const priceData = await checkout(1.005, 'AED');
    expect(Number.isInteger(priceData.unit_amount)).toBe(true);
  });

  // refundPayment is the OTHER amount conversion in this provider. As of Phase
  // 2a/A4 RefundPaymentParams carries the original charge's currency, so this
  // is genuinely currency-aware rather than falling back to a factor of 100 -
  // which it did until now, and which would have under-refunded any 3-decimal
  // currency by 10x.
  describe('refundPayment', () => {
    it('converts the refund amount to minor units', async () => {
      createRefund.mockReset();
      createRefund.mockResolvedValue({ id: 're_test_1' });
      const provider = new StripePaymentProvider();
      await provider.refundPayment({
        chargeReference: 'pi_test_1',
        amount: 24.5,
        currency: 'AED',
        credentials: { secretKey: 'sk_test_refund' },
      });
      const calls = createRefund.mock.calls as unknown as {
        payment_intent: string;
        amount: number;
      }[][];
      expect(calls[0][0].amount).toBe(2450);
      expect(Number.isInteger(calls[0][0].amount)).toBe(true);
    });

    it('uses the 3-decimal factor for a KWD charge, not 100', async () => {
      createRefund.mockReset();
      createRefund.mockResolvedValue({ id: 're_test_kwd' });
      const provider = new StripePaymentProvider();
      await provider.refundPayment({
        chargeReference: 'pi_test_kwd',
        amount: 24.5,
        currency: 'KWD',
        credentials: { secretKey: 'sk_test_refund' },
      });
      const calls = createRefund.mock.calls as unknown as {
        amount: number;
      }[][];
      // 24500, not 2450. The old `undefined` currency made this 2450 — a
      // refund of 2.450 KWD against a 24.500 KWD charge.
      expect(calls[0][0].amount).toBe(24500);
    });
  });

});
