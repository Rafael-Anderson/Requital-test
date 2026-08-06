import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Delete,
} from '@nestjs/common';
import { JobsService } from './jobs.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Minimal ops-visibility surface for the Phase 5 job queue — admin-only
// (same tier as staff management/outlets), not exposed to branch/
// order_manager/viewer. Every method is scoped by ctx.shopId, either via the
// listDeadLetter query filter or via JobsService.retry/dismiss's own
// (id, shopId) updateMany — a job belonging to another shop 404s rather
// than leaking or being mutable from here.
@Roles('admin')
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get('failed')
  listFailed(@CurrentUser() ctx: TenantContext) {
    return this.jobsService.listDeadLetter(ctx.shopId);
  }

  @Post(':id/retry')
  retry(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.jobsService.retry(ctx.shopId, id);
  }

  @Delete(':id')
  dismiss(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.jobsService.dismiss(ctx.shopId, id);
  }
}
