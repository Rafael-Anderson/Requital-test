import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { TenantContext } from '../../common/tenant-context';

// AuthGuard populates request.user for every non-@Public() route before a
// controller method runs, so this is always defined wherever it's injected.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user: TenantContext }>();
    return request.user;
  },
);
