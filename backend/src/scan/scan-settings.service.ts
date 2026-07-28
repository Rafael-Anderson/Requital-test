import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import { UpdateScanSettingsDto } from './dto/update-scan-settings.dto';
import { DEFAULT_EXCLUDE_KEYWORDS } from './ocr-parser';

export interface ScanSettingsResponse {
  shopId: number;
  excludeKeywords: string[];
  includeKeywords: string[];
  defaultOutletId: number | null;
  unmatchedBehavior: 'ask' | 'create';
}

// Same upsert-by-shopId, defaults-when-no-row-yet convention as
// SeoService/ThemeService — see seo.service.ts.
@Injectable()
export class ScanSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async findOne(ctx: TenantContext): Promise<ScanSettingsResponse> {
    const settings = await this.prisma.scansettings.findUnique({ where: { shopId: ctx.shopId } });
    if (!settings) {
      return {
        shopId: ctx.shopId,
        excludeKeywords: DEFAULT_EXCLUDE_KEYWORDS,
        includeKeywords: [],
        defaultOutletId: null,
        unmatchedBehavior: 'ask',
      };
    }
    return {
      shopId: settings.shopId,
      excludeKeywords: settings.excludeKeywords as string[],
      includeKeywords: settings.includeKeywords as string[],
      defaultOutletId: settings.defaultOutletId,
      unmatchedBehavior: settings.unmatchedBehavior as 'ask' | 'create',
    };
  }

  async upsert(ctx: TenantContext, dto: UpdateScanSettingsDto): Promise<ScanSettingsResponse> {
    if (dto.defaultOutletId) {
      const outlet = await this.prisma.outlet.findFirst({
        where: { id: dto.defaultOutletId, shopId: ctx.shopId },
      });
      if (!outlet) {
        throw new BadRequestException('defaultOutletId is invalid for this shop');
      }
    }

    const settings = await this.prisma.scansettings.upsert({
      where: { shopId: ctx.shopId },
      create: {
        shopId: ctx.shopId,
        excludeKeywords: dto.excludeKeywords ?? DEFAULT_EXCLUDE_KEYWORDS,
        includeKeywords: dto.includeKeywords ?? [],
        defaultOutletId: dto.defaultOutletId ?? null,
        unmatchedBehavior: dto.unmatchedBehavior ?? 'ask',
      },
      update: {
        ...(dto.excludeKeywords !== undefined && { excludeKeywords: dto.excludeKeywords }),
        ...(dto.includeKeywords !== undefined && { includeKeywords: dto.includeKeywords }),
        ...(dto.defaultOutletId !== undefined && { defaultOutletId: dto.defaultOutletId }),
        ...(dto.unmatchedBehavior !== undefined && { unmatchedBehavior: dto.unmatchedBehavior }),
      },
    });

    return {
      shopId: settings.shopId,
      excludeKeywords: settings.excludeKeywords as string[],
      includeKeywords: settings.includeKeywords as string[],
      defaultOutletId: settings.defaultOutletId,
      unmatchedBehavior: settings.unmatchedBehavior as 'ask' | 'create',
    };
  }
}
