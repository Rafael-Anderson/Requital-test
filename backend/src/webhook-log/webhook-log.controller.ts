import { Controller, Get } from '@nestjs/common';
import { WebhookLogService } from './webhook-log.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Read-only diagnostics for Integrations > Webhooks — admin-only, same tier
// as every other integration-settings route. Never exposes a webhook URL or
// token (those are platform-level, not per-shop — see CLAUDE.md).
@Roles('admin')
@Controller('webhook-log')
export class WebhookLogController {
  constructor(private readonly webhookLogService: WebhookLogService) {}

  @Get()
  listRecent(@CurrentUser() ctx: TenantContext) {
    return this.webhookLogService.listRecent(ctx.shopId);
  }
}
