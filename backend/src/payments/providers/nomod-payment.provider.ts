import { Injectable } from '@nestjs/common';
import {
  RefundNotAttemptedError,
  type CheckoutSession,
  type CheckoutSessionOutcome,
  type CreateCheckoutSessionParams,
  type PaymentProvider,
  type RefundPaymentParams,
  type RefundResult,
  type WebhookResult,
} from '../payment-provider.interface';
import { PaymentProviderNotConfiguredException } from '../payment-provider-not-configured.exception';
import {
  PaymentCurrencyNotSupportedException,
  isGatewayCurrencyBlocked,
} from '../blocked-gateway-currencies';
import { createLogger } from '../../common/logging/logger';
import { minorToDecimal } from '../../drivers/cash';
import { toMinorUnits } from '../../common/currency-minor-units';
import { NomodApiError, NomodClient } from '../nomod/nomod-client';
import {
  NomodPaymentService,
  nomodCredentials,
} from '../nomod/nomod-payment.service';
import { exactMinor } from '../nomod/nomod-events';

const logger = createLogger('NomodPaymentProvider');

// Nomod (UAE) Hosted Checkout. The customer is redirected to Nomod's page and pays
// there; the order is marked paid ONLY by a verified webhook (NomodWebhookService),
// a GET /v1/checkout/{id} confirmation (NomodConfirmService) or the reconciliation
// sweep (retrieveSessionOutcome below), never by a return URL.
//
// The provider itself holds no state and does its DB work through
// NomodPaymentService. Constructed without one (a unit test of isUsable) it can
// still answer isUsable, and every other method refuses.
@Injectable()
export class NomodPaymentProvider implements PaymentProvider {
  readonly name = 'nomod';

  constructor(
    private readonly payments?: NomodPaymentService,
    private readonly client: NomodClient = new NomodClient(),
  ) {}

  // Usable = the shop saved BOTH an API key and a webhook signing secret. (The
  // platform grant, the nomod_payments feature, is checked by
  // PaymentSettingsService.isEnabled and again inside createCheckoutSession.)
  isUsable(credentials: Record<string, string> | null): boolean {
    return !!(
      credentials?.apiKey?.trim() && credentials?.webhookSecret?.trim()
    );
  }

  async createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<CheckoutSession> {
    // MANDATORY GUARD, inside the provider and not only in the callers that resolved
    // credentials (see CLAUDE.md, "Payment provider toggle-bypass guard"): no
    // credentials means Nomod is not configured, whatever a toggle says.
    if (!this.isUsable(params.credentials ?? null) || !this.payments) {
      throw new PaymentProviderNotConfiguredException('Nomod');
    }
    // Currency allow-list (AED, USD, EUR, GBP, SAR), enforced here as well as in the
    // early rejections.
    if (isGatewayCurrencyBlocked(this.name, params.currency)) {
      throw new PaymentCurrencyNotSupportedException(
        this.name,
        params.currency,
      );
    }
    return this.payments.createCheckout(params);
  }

  // What the reconciliation sweep asks when a webhook never arrived. `sessionId` is
  // the Nomod checkout id. A paid answer is returned ONLY after the amount and
  // currency Nomod reports match the order (otherwise the order is parked for
  // review and this says "unpaid"), so the sweep, which applies a paid outcome as it
  // stands, can never mark an order paid on a mismatch.
  async retrieveSessionOutcome(
    sessionId: string,
    credentials?: Record<string, string> | null,
  ): Promise<CheckoutSessionOutcome | null> {
    if (!this.payments) return null;
    const row = await this.payments.findByCheckoutId(sessionId);
    if (!row) return null;
    const verdict = await this.payments.inspect(row, credentials ?? null);
    switch (verdict.kind) {
      case 'paid':
        // The Nomod checkout id is the charge reference: it is what a refund needs.
        return { status: 'paid', chargeReference: row.checkoutId ?? undefined };
      case 'expired':
      case 'cancelled':
        return { status: 'expired' };
      default:
        return { status: 'unpaid' };
    }
  }

  // Webhooks do not come through here: Nomod's Standard Webhooks need three headers
  // and a per-shop token route, handled by NomodWebhookService. This route-agnostic
  // hook is never reached for Nomod.
  parseWebhookEvent(): WebhookResult | null {
    logger.warn('nomod webhooks are handled by NomodWebhookService, ignoring');
    return null;
  }

  // HTTP only: it is called under the order row lock (ReturnsService.create), so it
  // must not touch the pool. `chargeReference` is the Nomod checkout id.
  async refundPayment(params: RefundPaymentParams): Promise<RefundResult> {
    const creds = nomodCredentials(params.credentials);
    if (!creds) throw new PaymentProviderNotConfiguredException('Nomod');
    if (!params.idempotencyKey) {
      // Nomod requires one. Refusing is safer than inventing a random one, which
      // would make a retry a second refund.
      throw new Error('a Nomod refund needs an idempotency key');
    }
    const refundMinor = toMinorUnits(params.amount, params.currency);
    if (refundMinor <= 0) throw new Error('nothing to refund');

    // The charge we are refunding: its currency and amount are read from Nomod, and
    // our own stored figures decide the request, never a refund response amount.
    const checkout = await this.client.getCheckout(
      creds,
      params.chargeReference,
    );
    if (
      !checkout.currency ||
      checkout.currency.toUpperCase() !== params.currency.toUpperCase()
    ) {
      throw new RefundNotAttemptedError(
        'the Nomod charge is in a different currency',
      );
    }
    const chargedMinor = exactMinor(checkout.amount, checkout.currency);
    if (chargedMinor === null) {
      throw new RefundNotAttemptedError(
        'the Nomod charge has no readable amount',
      );
    }
    if (refundMinor > chargedMinor) {
      throw new RefundNotAttemptedError(
        'refund is larger than the Nomod charge',
      );
    }
    // Partial refunds are not documented for Nomod: off unless the merchant turned
    // the setting on. Anything short of the whole charge is refused here, which
    // makes the caller record a manual refund (do it in the Nomod dashboard).
    const allowPartial = params.credentials?.allowPartialRefunds === 'true';
    if (refundMinor < chargedMinor && !allowPartial) {
      throw new RefundNotAttemptedError(
        'partial refunds through Nomod are turned off for this shop',
      );
    }

    try {
      const res = await this.client.refund(creds, params.chargeReference, {
        amount: minorToDecimal(refundMinor, params.currency),
        idempotencyKey: params.idempotencyKey,
      });
      if ((res.status ?? '').toLowerCase() === 'failed') {
        throw new Error('Nomod reported the refund as failed');
      }
      return {
        providerReference: res.refundId,
        status:
          (res.status ?? '').toLowerCase() === 'completed'
            ? 'completed'
            : 'pending',
      };
    } catch (err) {
      logger.warn('nomod refund failed', {
        status: err instanceof NomodApiError ? err.status : null,
      });
      throw err;
    }
  }
}
