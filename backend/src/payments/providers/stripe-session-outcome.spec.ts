import { StripePaymentProvider } from './stripe-payment.provider';

// Deliberately its own file rather than added to stripe-payment.provider.spec.ts:
// PR #148 (the currency fixes) creates that file, and putting these cases there
// would guarantee a merge conflict between two branches that are otherwise
// independent.
const retrieveSession = jest.fn();
jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    checkout: { sessions: { retrieve: retrieveSession } },
  })),
);

describe('StripePaymentProvider.retrieveSessionOutcome', () => {
  const provider = new StripePaymentProvider();
  const creds = { secretKey: 'sk_test_reconcile' };

  beforeEach(() => retrieveSession.mockReset());

  it('reports paid and carries the payment intent as the charge reference', async () => {
    retrieveSession.mockResolvedValue({
      status: 'complete',
      payment_status: 'paid',
      payment_intent: 'pi_test_1',
    });
    await expect(
      provider.retrieveSessionOutcome('cs_test_1', creds),
    ).resolves.toEqual({ status: 'paid', chargeReference: 'pi_test_1' });
  });

  it('accepts an expanded payment_intent object as well as a string id', async () => {
    retrieveSession.mockResolvedValue({
      status: 'complete',
      payment_status: 'paid',
      payment_intent: { id: 'pi_test_2' },
    });
    await expect(
      provider.retrieveSessionOutcome('cs_test_2', creds),
    ).resolves.toEqual({ status: 'paid', chargeReference: 'pi_test_2' });
  });

  // THE case that matters most. A session can be 'complete' while the payment
  // has not settled (a delayed method). Reading session.status instead of
  // payment_status here would mark an order paid for money that never arrived -
  // strictly worse than the missed-webhook bug this whole feature fixes.
  it('does NOT report paid for a completed session whose payment is unpaid', async () => {
    retrieveSession.mockResolvedValue({
      status: 'complete',
      payment_status: 'unpaid',
    });
    await expect(
      provider.retrieveSessionOutcome('cs_test_3', creds),
    ).resolves.toEqual({ status: 'unpaid' });
  });

  it('reports expired for an expired session', async () => {
    retrieveSession.mockResolvedValue({
      status: 'expired',
      payment_status: 'unpaid',
    });
    await expect(
      provider.retrieveSessionOutcome('cs_test_4', creds),
    ).resolves.toEqual({ status: 'expired' });
  });

  it('reports unpaid for a session still open', async () => {
    retrieveSession.mockResolvedValue({
      status: 'open',
      payment_status: 'unpaid',
    });
    await expect(
      provider.retrieveSessionOutcome('cs_test_5', creds),
    ).resolves.toEqual({ status: 'unpaid' });
  });

  // A session id Stripe no longer resolves is a reason to leave the order
  // alone, not to fail the sweep for every order queued behind it.
  it('returns null when the gateway has no such session', async () => {
    retrieveSession.mockResolvedValue(null);
    await expect(
      provider.retrieveSessionOutcome('cs_missing', creds),
    ).resolves.toBeNull();
  });

  it('treats no_payment_required as not-paid rather than assuming money moved', async () => {
    retrieveSession.mockResolvedValue({
      status: 'complete',
      payment_status: 'no_payment_required',
    });
    await expect(
      provider.retrieveSessionOutcome('cs_test_6', creds),
    ).resolves.toEqual({ status: 'unpaid' });
  });
});
