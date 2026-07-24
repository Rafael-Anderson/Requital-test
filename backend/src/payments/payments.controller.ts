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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

@Controller('orders')
export class PaymentLinkController {
  constructor(private readonly paymentsService: PaymentsService) {}

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

@Controller('payments/webhook')
export class PaymentsWebhookController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Public()
  @Post('stripe')
  handleStripeWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    return this.paymentsService.handleWebhook(request.rawBody!, signature);
  }
}
