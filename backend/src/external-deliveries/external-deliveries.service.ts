import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import { CreateExternalDeliveryDto } from './dto/create-external-delivery.dto';
import { UpdateExternalDeliveryDto } from './dto/update-external-delivery.dto';

@Injectable()
export class ExternalDeliveriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ctx: TenantContext, orderId: number, dto: CreateExternalDeliveryDto) {
    await this.assertOrderBelongsToShop(ctx, orderId);
    try {
      return await this.prisma.externaldelivery.create({
        data: {
          orderId,
          carrier: dto.carrier,
          vehicleType: dto.vehicleType,
          price: dto.price,
          destination: dto.destination,
          status: dto.status ?? 'pending',
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // One record per order, by design — see the schema comment.
        throw new ConflictException('This order already has an external delivery logged');
      }
      throw error;
    }
  }

  async update(ctx: TenantContext, orderId: number, dto: UpdateExternalDeliveryDto) {
    await this.assertOrderBelongsToShop(ctx, orderId);
    const existing = await this.prisma.externaldelivery.findUnique({ where: { orderId } });
    if (!existing) {
      throw new NotFoundException('No external delivery logged for this order yet');
    }
    return this.prisma.externaldelivery.update({ where: { orderId }, data: dto });
  }

  private async assertOrderBelongsToShop(ctx: TenantContext, orderId: number) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, shopId: ctx.shopId } });
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
  }
}
