import { Controller, Get, Query } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';
import { ListAuditLogQueryDto } from './dto/list-audit-log-query.dto';

// Admin + viewer (reporting role) — same tier as Reports/Dashboard. Never
// 'branch'/'order_manager': the log includes things outside their own
// domain (staff logins, other outlets' bulk actions) that aren't theirs to see.
@Roles('admin', 'viewer')
@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  list(@CurrentUser() ctx: TenantContext, @Query() query: ListAuditLogQueryDto) {
    return this.auditLogService.list(ctx, query);
  }

  @Get('actors')
  listActors(@CurrentUser() ctx: TenantContext) {
    return this.auditLogService.listActors(ctx);
  }
}
