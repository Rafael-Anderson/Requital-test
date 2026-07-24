import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateShopDto } from './dto/update-shop.dto';
import { SOCIAL_PLATFORM_DOMAINS, SOCIAL_PLATFORMS } from './constants';
import type { TenantContext } from '../common/tenant-context';

@Injectable()
export class ShopService {
  constructor(private readonly prisma: PrismaService) {}

  findOne(ctx: TenantContext) {
    return this.prisma.shop.findUniqueOrThrow({ where: { id: ctx.shopId } });
  }

  async update(ctx: TenantContext, dto: UpdateShopDto) {
    if (dto.socialLinks) {
      this.validateSocialLinks(dto.socialLinks);
    }

    const touchesDeliveryPayment =
      dto.deliveryPaymentCardOnline !== undefined ||
      dto.deliveryPaymentCashOnDelivery !== undefined ||
      dto.deliveryPaymentCardOnDelivery !== undefined;
    const touchesPickupPayment =
      dto.pickupPaymentCardOnline !== undefined ||
      dto.pickupPaymentCashOnPickup !== undefined ||
      dto.pickupPaymentCardOnPickup !== undefined;

    if (touchesDeliveryPayment || touchesPickupPayment) {
      // Checked against the merged (existing + incoming) state, not just
      // this request's fields — a partial update that only sends one method
      // must still know whether the other two are already on.
      const current = await this.prisma.shop.findUniqueOrThrow({
        where: { id: ctx.shopId },
      });
      if (touchesDeliveryPayment) {
        this.assertAtLeastOnePaymentMethod('delivery', [
          dto.deliveryPaymentCardOnline ?? current.deliveryPaymentCardOnline,
          dto.deliveryPaymentCashOnDelivery ?? current.deliveryPaymentCashOnDelivery,
          dto.deliveryPaymentCardOnDelivery ?? current.deliveryPaymentCardOnDelivery,
        ]);
      }
      if (touchesPickupPayment) {
        this.assertAtLeastOnePaymentMethod('pickup', [
          dto.pickupPaymentCardOnline ?? current.pickupPaymentCardOnline,
          dto.pickupPaymentCashOnPickup ?? current.pickupPaymentCashOnPickup,
          dto.pickupPaymentCardOnPickup ?? current.pickupPaymentCardOnPickup,
        ]);
      }
    }

    return this.prisma.shop.update({ where: { id: ctx.shopId }, data: dto });
  }

  // Key must be a known platform; value must be a syntactically valid
  // http(s) URL whose hostname loosely matches that platform's domain. Not
  // checking the link actually resolves — just catches typos/wrong-platform
  // pastes, per the "don't over-engineer this" brief.
  private validateSocialLinks(socialLinks: Record<string, string>) {
    for (const [platform, url] of Object.entries(socialLinks)) {
      if (!SOCIAL_PLATFORMS.includes(platform)) {
        throw new BadRequestException(`Unknown social platform '${platform}'`);
      }
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new BadRequestException(`'${url}' is not a valid URL for ${platform}`);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new BadRequestException(`${platform} link must be http(s)`);
      }
      const expectedDomains = SOCIAL_PLATFORM_DOMAINS[platform];
      if (!expectedDomains.some((domain) => parsed.hostname.endsWith(domain))) {
        throw new BadRequestException(`'${url}' doesn't look like a ${platform} link`);
      }
    }
  }

  private assertAtLeastOnePaymentMethod(context: 'delivery' | 'pickup', methods: boolean[]) {
    if (!methods.some(Boolean)) {
      throw new BadRequestException(`At least one ${context} payment method must be enabled`);
    }
  }
}
