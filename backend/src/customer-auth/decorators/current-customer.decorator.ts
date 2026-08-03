import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { CustomerContext } from '../customer-context';

// CustomerAuthGuard populates request.customer for every route it guards —
// always defined wherever this is injected (mirrors CurrentUser/TenantContext).
export const CurrentCustomer = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CustomerContext => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { customer: CustomerContext }>();
    return request.customer;
  },
);
