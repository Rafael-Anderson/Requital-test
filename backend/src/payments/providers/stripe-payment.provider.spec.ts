import { StripePaymentProvider } from './stripe-payment.provider';
import { PaymentCurrencyNotSupportedException } from '../blocked-gateway-currencies';
import { toMinorUnits } from '../../common/currency-minor-units';

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
      orderNumber: 1,
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

  // Live Stripe checkout is blocked for the three-decimal currencies until the
  // owner decides the handling (blocked-gateway-currencies.ts). The guard throws
  // BEFORE any Stripe client is built or called, so nothing can be charged.
  it.each(['KWD', 'BHD', 'OMR', 'kwd'])(
    'refuses to create a %s checkout session and never calls Stripe',
    async (currency) => {
      const provider = new StripePaymentProvider();
      await expect(
        provider.createCheckoutSession({
          orderId: 1,
          orderNumber: 1,
          amount: 33.091,
          currency,
          successUrl: 'https://shop.example/success',
          cancelUrl: 'https://shop.example/cancel',
          credentials: { secretKey: 'sk_test_blocked' },
        }),
      ).rejects.toBeInstanceOf(PaymentCurrencyNotSupportedException);
      expect(createSession).not.toHaveBeenCalled();
    },
  );

  it('still creates checkout sessions for AED, SAR, QAR and USD', async () => {
    for (const currency of ['AED', 'SAR', 'QAR', 'USD']) {
      createSession.mockClear();
      expect((await checkout(10.5, currency)).unit_amount).toBe(1050);
    }
  });

  // The conversion itself stays correct and covered even though the live call
  // is blocked (moved here from the KWD end-to-end spec): a 33.091 KWD total is
  // 33091 minor units, and x100 would send a tenth of the money.
  it('the three-decimal conversion is still x1000', () => {
    expect(toMinorUnits(33.091, 'KWD')).toBe(33091);
    expect(toMinorUnits(33.091, 'KWD')).not.toBe(Math.round(33.091 * 100));
    expect(toMinorUnits(10.5, 'BHD')).toBe(10500);
    expect(toMinorUnits(10.5, 'OMR')).toBe(10500);
  });

  it('always sends an integer amount', async () => {
    const priceData = await checkout(1.005, 'AED');
    expect(Number.isInteger(priceData.unit_amount)).toBe(true);
  });

  // The customer reads this line on Stripe's own page and receipt: it must be
  // the per-shop number they were shown, while the machine identity (the id the
  // webhook maps back to an order) stays the global id.
  it('labels the line with the per-shop order number and keeps the id in metadata', async () => {
    const provider = new StripePaymentProvider();
    await provider.createCheckoutSession({
      orderId: 9001,
      orderNumber: 7,
      amount: 10,
      currency: 'AED',
      successUrl: 'https://shop.example/success',
      cancelUrl: 'https://shop.example/cancel',
      credentials: { secretKey: 'sk_test_label' },
    });
    const arg = (
      createSession.mock.calls as unknown as {
        line_items: { price_data: { product_data: { name: string } } }[];
        metadata: { orderId: string };
      }[][]
    )[0][0];
    expect(arg.line_items[0].price_data.product_data.name).toBe('Order #7');
    expect(arg.metadata.orderId).toBe('9001');
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

    // Blocking checkout must not strand refunds: an order charged in KWD before
    // the block still refunds through Stripe, in the 3-decimal factor.
    it.each(['KWD', 'BHD', 'OMR'])(
      'still refunds a %s charge (the checkout block does not apply to refunds)',
      async (currency) => {
        createRefund.mockReset();
        createRefund.mockResolvedValue({ id: 're_test_blocked' });
        const provider = new StripePaymentProvider();
        const res = await provider.refundPayment({
          chargeReference: 'pi_test_old',
          amount: 33.091,
          currency,
          credentials: { secretKey: 'sk_test_refund' },
        });
        expect(res.providerReference).toBe('re_test_blocked');
        const calls = createRefund.mock.calls as unknown as {
          amount: number;
        }[][];
        expect(calls[0][0].amount).toBe(33091);
      },
    );
  });
});
