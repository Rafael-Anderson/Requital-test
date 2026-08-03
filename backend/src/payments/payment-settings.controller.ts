import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { PaymentSettingsService } from './payment-settings.service';
import { UpdatePaymentProviderDto } from './dto/update-payment-provider.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Admin-only, same as Theme/SEO/Shop — which gateways a shop accepts
// payment through, and their API credentials, is a business-level decision.
@Roles('admin')
@Controller('payment-settings')
export class PaymentSettingsController {
  constructor(
    private readonly paymentSettingsService: PaymentSettingsService,
  ) {}

  @Get()
  findAll(@CurrentUser() ctx: TenantContext) {
    return this.paymentSettingsService.findAll(ctx);
  }

  // :provider is one of PAYMENT_GATEWAY_PROVIDERS or 'cod' — validated
  // inside the service (a clean 400 for an unknown value, not a 404).
  @Patch(':provider')
  setProvider(
    @CurrentUser() ctx: TenantContext,
    @Param('provider') provider: string,
    @Body() dto: UpdatePaymentProviderDto,
  ) {
    return this.paymentSettingsService.setProvider(ctx, provider, dto);
  }
}
