import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { IsInt, IsOptional, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';
import { SessionsService } from './sessions.service';
import { CurrentUser } from './decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

class ListSessionsQuery {
  // Admin only (enforced in the service); omitted = the caller's own.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  userId?: number;
}

// Mutations here are staff-session endpoints, so the global staff CSRF
// middleware applies to them like every other non-GET route.
@Controller('auth/sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  list(@CurrentUser() ctx: TenantContext, @Query() q: ListSessionsQuery) {
    return this.sessions.list(ctx, q.userId);
  }

  // Declared before ':id' only for readability; the two never overlap (one
  // has no path segment).
  @Delete()
  revokeOthers(@CurrentUser() ctx: TenantContext) {
    return this.sessions.revokeOthers(ctx);
  }

  @Delete(':id')
  revoke(
    @CurrentUser() ctx: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.sessions.revoke(ctx, id);
  }
}
