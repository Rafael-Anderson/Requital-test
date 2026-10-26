import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequiresVerifiedEmail } from '../auth/decorators/requires-verified-email.decorator';
import { VerifiedEmailGuard } from '../auth/guards/verified-email.guard';
import type { TenantContext } from '../common/tenant-context';
import { SendingDomainsService } from './sending-domains.service';

export class PutSendingDomainDto {
  @IsString()
  @MaxLength(253)
  domain!: string;
}

// Admin only; the shop is always ctx.shopId, no id in the path to spoof.
@Roles('admin')
@Controller('shop/sending-domain')
export class SendingDomainsController {
  constructor(private readonly service: SendingDomainsService) {}

  @Get()
  async get(@CurrentUser() ctx: TenantContext) {
    return { sendingDomain: await this.service.get(ctx) };
  }

  @UseGuards(VerifiedEmailGuard)
  @RequiresVerifiedEmail({ action: 'connecting a sending domain' })
  @Put()
  put(@CurrentUser() ctx: TenantContext, @Body() dto: PutSendingDomainDto) {
    return this.service.put(ctx, dto.domain);
  }

  // Calls the provider, so it carries its own tight throttle.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify')
  verify(@CurrentUser() ctx: TenantContext) {
    return this.service.verify(ctx);
  }

  @Delete()
  remove(@CurrentUser() ctx: TenantContext) {
    return this.service.remove(ctx);
  }
}
