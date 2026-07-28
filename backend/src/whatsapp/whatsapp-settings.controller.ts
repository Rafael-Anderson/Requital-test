import { Body, Controller, Delete, Get, Patch } from '@nestjs/common';
import { WhatsAppSettingsService } from './whatsapp-settings.service';
import { SetWhatsAppCredentialsDto } from './dto/set-whatsapp-credentials.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Credential entry, same access tier as Payment Gateways settings — admin
// only. Meta's own business verification/number setup happens outside this
// app; this is just where the resulting phoneNumberId/accessToken get
// pasted in and stored encrypted.
@Roles('admin')
@Controller('whatsapp-settings')
export class WhatsAppSettingsController {
  constructor(private readonly whatsAppSettingsService: WhatsAppSettingsService) {}

  @Get()
  find(@CurrentUser() ctx: TenantContext) {
    return this.whatsAppSettingsService.find(ctx);
  }

  @Patch()
  setCredentials(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: SetWhatsAppCredentialsDto,
  ) {
    return this.whatsAppSettingsService.setCredentials(ctx, dto);
  }

  @Delete()
  clear(@CurrentUser() ctx: TenantContext) {
    return this.whatsAppSettingsService.clearCredentials(ctx);
  }
}
