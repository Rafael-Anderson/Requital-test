import {
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

@Controller('orders')
export class PaymentLinkController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // Part of the order lifecycle, same allow-list as OrdersController's own
  // mutations (updateStatus/cancel) — 'viewer' excluded. Previously had no
  // role guard at all.
  @Roles('admin', 'branch', 'order_manager')
  @Post(':id/payment-link')
  generateLink(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.paymentsService.generateLink(ctx, id);
  }
}

// Public, token-authenticated — reached from the storefront's hosted
// checkout page, not the merchant admin panel.
@Controller('pay')
export class PayController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Public()
  @Get(':token')
  getCheckoutSession(@Param('token') token: string) {
    return this.paymentsService.getCheckoutSession(token);
  }
}

// PayPal verifies its webhooks via a remote API call that needs 5 headers
// together (transmission id/time/cert url/auth algo/signature), not the
// single header value every other gateway here reads — bundled into one
// JSON string so it still fits the shared handleWebhook(gateway, rawBody,
// signatureHeader, shopId?) shape. Decoded on the other end by
// PayPalPaymentProvider.parseWebhookEvent.
function extractPayPalHeaders(request: Request): string {
  return JSON.stringify({
    transmissionId: request.headers['paypal-transmission-id'],
    transmissionTime: request.headers['paypal-transmission-time'],
    certUrl: request.headers['paypal-cert-url'],
    authAlgo: request.headers['paypal-auth-algo'],
    transmissionSig: request.headers['paypal-transmission-sig'],
  });
}

// One route per registered gateway, all funneling into the same
// PaymentsService.handleWebhook — :gateway in the path (not anything in the
// payload) picks which provider's parseWebhookEvent verifies/parses this
// delivery. The signature-header name genuinely differs per gateway (Stripe
// and PayPal are confirmed real; the others are read from the header a real
// integration will actually use once one exists — TODO when wiring up
// Telr/PayTabs/Tabby/Tamara for real.
@Controller('payments/webhook')
export class PaymentsWebhookController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Public()
  @Post('stripe')
  handleStripeWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    return this.paymentsService.handleWebhook(
      'stripe',
      request.rawBody!,
      signature,
    );
  }

  // Per-shop route: a merchant using their own Stripe account configures
  // *this* URL (with their own shopId) in their Stripe Dashboard's webhook
  // settings, instead of the platform-wide route above — see the Payment
  // Gateways settings page, which surfaces the exact URL to copy. Verified
  // against that shop's own stored webhookSecret credential, resolved
  // before signature verification even runs (see PaymentsService).
  @Public()
  @Post('stripe/:shopId')
  handleStripeWebhookForShop(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
    @Param('shopId', ParseIntPipe) shopId: number,
  ) {
    return this.paymentsService.handleWebhook(
      'stripe',
      request.rawBody!,
      signature,
      shopId,
    );
  }

  @Public()
  @Post('telr')
  handleTelrWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-telr-signature') signature: string,
  ) {
    return this.paymentsService.handleWebhook(
      'telr',
      request.rawBody!,
      signature ?? '',
    );
  }

  @Public()
  @Post('paytabs')
  handlePayTabsWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('signature') signature: string,
  ) {
    return this.paymentsService.handleWebhook(
      'paytabs',
      request.rawBody!,
      signature ?? '',
    );
  }

  @Public()
  @Post('tabby')
  handleTabbyWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-tabby-signature') signature: string,
  ) {
    return this.paymentsService.handleWebhook(
      'tabby',
      request.rawBody!,
      signature ?? '',
    );
  }

  @Public()
  @Post('tamara')
  handleTamaraWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-tamara-signature') signature: string,
  ) {
    return this.paymentsService.handleWebhook(
      'tamara',
      request.rawBody!,
      signature ?? '',
    );
  }

  @Public()
  @Post('paypal')
  handlePayPalWebhook(@Req() request: RawBodyRequest<Request>) {
    return this.paymentsService.handleWebhook(
      'paypal',
      request.rawBody!,
      extractPayPalHeaders(request),
    );
  }

  // Per-shop route, same purpose as Stripe's own — a merchant using their
  // own PayPal app configures this URL (with their own shopId) as the
  // webhook target in their PayPal Developer Dashboard.
  @Public()
  @Post('paypal/:shopId')
  handlePayPalWebhookForShop(
    @Req() request: RawBodyRequest<Request>,
    @Param('shopId', ParseIntPipe) shopId: number,
  ) {
    return this.paymentsService.handleWebhook(
      'paypal',
      request.rawBody!,
      extractPayPalHeaders(request),
      shopId,
    );
  }
}
