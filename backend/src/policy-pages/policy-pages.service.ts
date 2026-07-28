import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import { POLICY_PAGE_TYPES, type PolicyPageType } from './policy-page-constants';
import { UpsertPolicyPageDto } from './dto/upsert-policy-page.dto';

@Injectable()
export class PolicyPagesService {
  constructor(private readonly prisma: PrismaService) {}

  // All 5 types, always — a type with no saved row comes back as
  // `content: null` rather than being omitted, so the admin UI can render a
  // consistent 5-row list (written vs. not written) instead of a variable-
  // length one.
  async findAll(ctx: TenantContext) {
    const rows = await this.prisma.policypage.findMany({ where: { shopId: ctx.shopId } });
    const byType = new Map(rows.map((r) => [r.type, r]));
    return POLICY_PAGE_TYPES.map((type) => {
      const row = byType.get(type);
      return { type, content: row?.content ?? null, updatedAt: row?.updatedAt ?? null };
    });
  }

  upsert(ctx: TenantContext, type: PolicyPageType, dto: UpsertPolicyPageDto) {
    return this.prisma.policypage.upsert({
      where: { shopId_type: { shopId: ctx.shopId, type } },
      create: { shopId: ctx.shopId, type, content: dto.content },
      update: { content: dto.content },
    });
  }

  // Public — no auth, resolved by shopId (already tenant-scoped by the
  // caller, see PublicService.getPolicyPage) rather than trusting a
  // client-supplied shopId directly.
  async findPublic(shopId: number, type: PolicyPageType) {
    const row = await this.prisma.policypage.findUnique({
      where: { shopId_type: { shopId, type } },
    });
    // 404, not a null/empty body — a policy type with no content isn't a
    // real page (see Footer.tsx, which never links to one in that state),
    // so reaching this URL directly should read as "not found," not "found
    // but blank."
    if (!row) {
      throw new NotFoundException(`No ${type} policy page has been published for this shop`);
    }
    return row;
  }
}
