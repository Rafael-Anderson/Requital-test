import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { TenantContext } from '../../common/tenant-context';
import { NomodAdminService } from './nomod-admin.service';

// Admin-only, like the rest of payment settings. Nothing here ever returns a key or a
// signing secret.
@Roles('admin')
@Controller('payment-settings/nomod')
export class NomodSettingsController {
  constructor(private readonly admin: NomodAdminService) {}

  @Post('webhook-url')
  webhookUrl(@CurrentUser() ctx: TenantContext) {
    return this.admin.webhookPath(ctx);
  }

  @Post('webhook-url/rotate')
  rotate(@CurrentUser() ctx: TenantContext) {
    return this.admin.rotateWebhookPath(ctx);
  }

  @Post('test-connection')
  testConnection(@CurrentUser() ctx: TenantContext) {
    return this.admin.testConnection(ctx);
  }

  @Get('pending')
  pending(
    @CurrentUser() ctx: TenantContext,
    @Query('minutes') minutes?: string,
  ) {
    const n = Number(minutes);
    return this.admin.listPending(
      ctx,
      Number.isInteger(n) && n >= 1 && n <= 10_080 ? n : 15,
    );
  }

  @Post('pending/:id/recheck')
  recheck(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.admin.recheck(ctx, id);
  }
}
