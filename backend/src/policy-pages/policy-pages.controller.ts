import { BadRequestException, Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { PolicyPagesService } from './policy-pages.service';
import { UpsertPolicyPageDto } from './dto/upsert-policy-page.dto';
import { POLICY_PAGE_TYPES, type PolicyPageType } from './policy-page-constants';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

function assertValidType(type: string): asserts type is PolicyPageType {
  if (!(POLICY_PAGE_TYPES as readonly string[]).includes(type)) {
    throw new BadRequestException(`Unknown policy page type '${type}' — must be one of ${POLICY_PAGE_TYPES.join(', ')}`);
  }
}

// Admin-only, same access level as Theme/SEO — merchant-facing storefront
// content, not something branch staff manage.
@Roles('admin')
@Controller('shop/policy-pages')
export class PolicyPagesController {
  constructor(private readonly policyPagesService: PolicyPagesService) {}

  @Get()
  findAll(@CurrentUser() ctx: TenantContext) {
    return this.policyPagesService.findAll(ctx);
  }

  @Patch(':type')
  upsert(@CurrentUser() ctx: TenantContext, @Param('type') type: string, @Body() dto: UpsertPolicyPageDto) {
    assertValidType(type);
    return this.policyPagesService.upsert(ctx, type, dto);
  }
}
