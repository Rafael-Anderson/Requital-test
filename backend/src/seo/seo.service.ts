import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import { UpdateSeoDto } from './dto/update-seo.dto';

@Injectable()
export class SeoService {
  constructor(private readonly prisma: PrismaService) {}

  async findOne(ctx: TenantContext) {
    const seo = await this.prisma.shopseosettings.findUnique({ where: { shopId: ctx.shopId } });
    // Same convention as ThemeService.findOne — no row yet is a valid,
    // common state (nothing saved), not an error.
    return (
      seo ?? {
        shopId: ctx.shopId,
        metaTitle: null,
        metaDescription: null,
        ogImage: null,
        keywords: null,
      }
    );
  }

  upsert(ctx: TenantContext, dto: UpdateSeoDto) {
    return this.prisma.shopseosettings.upsert({
      where: { shopId: ctx.shopId },
      create: { shopId: ctx.shopId, ...dto },
      update: dto,
    });
  }
}
