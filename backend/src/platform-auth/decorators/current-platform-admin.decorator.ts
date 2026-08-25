import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { PlatformAdminContext } from '../guards/platform-admin.guard';

export const CurrentPlatformAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PlatformAdminContext => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { platformAdmin: PlatformAdminContext }>();
    return request.platformAdmin;
  },
);
