import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { TenantContext } from '../common/tenant-context';
import { AuditLogService } from '../audit-log/audit-log.service';
import type {
  ChannelitemmappingRow,
  ChannelunmappeditemRow,
} from '../db/types';
import { ChannelIngestionService } from './channel-ingestion.service';
import { ChannelProviderRegistry } from './channel-provider.registry';
import type {
  CreateChannelMappingDto,
  ResolveUnmappedItemDto,
} from './dto/channels.dto';

// Admin-only. A mapping says "marketplace item X is this product/variant". It
// never creates a product: an unknown item waits in the unmapped queue until a
// human maps it.
@Injectable()
export class ChannelMappingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditLogService,
    private readonly registry: ChannelProviderRegistry,
    private readonly ingestion: ChannelIngestionService,
  ) {}

  async list(ctx: TenantContext, provider?: string) {
    return this.db.query<(ChannelitemmappingRow & RowDataPacket)[]>(
      `SELECT m.*, p.name AS productName
         FROM channelitemmapping m JOIN product p ON p.id = m.productId AND p.shopId = m.shopId
        WHERE m.shopId = ? ${provider ? 'AND m.provider = ?' : ''}
        ORDER BY m.id DESC`,
      provider ? [ctx.shopId, provider] : [ctx.shopId],
    );
  }

  // Validates the target against THIS shop: a product or variant id from another
  // shop is a 400, a gift card cannot be a marketplace item, and a product with
  // options needs a variant (and one without cannot have one).
  private async assertTarget(
    shopId: number,
    productId: number,
    variantId: number | undefined,
  ): Promise<void> {
    const products = await this.db.query<RowDataPacket[]>(
      `SELECT id, isGiftCard FROM product WHERE id = ? AND shopId = ?`,
      [productId, shopId],
    );
    if (products.length === 0)
      throw new BadRequestException('productId is invalid for this shop');
    if (products[0].isGiftCard)
      throw new BadRequestException('A gift card cannot be a marketplace item');
    const options = await this.db.query<RowDataPacket[]>(
      `SELECT 1 FROM productoption WHERE productId = ? LIMIT 1`,
      [productId],
    );
    if (options.length > 0 && variantId === undefined) {
      throw new BadRequestException(
        'This product has options: choose a variant',
      );
    }
    if (options.length === 0 && variantId !== undefined) {
      throw new BadRequestException('This product has no variants');
    }
    if (variantId !== undefined) {
      const v = await this.db.query<RowDataPacket[]>(
        `SELECT v.id FROM productvariant v JOIN product p ON p.id = v.productId
          WHERE v.id = ? AND v.productId = ? AND p.shopId = ?`,
        [variantId, productId, shopId],
      );
      if (v.length === 0)
        throw new BadRequestException('variantId is invalid for this product');
    }
  }

  async create(ctx: TenantContext, dto: CreateChannelMappingDto) {
    if (!this.registry.has(dto.provider)) {
      throw new BadRequestException(
        `Unknown channel provider '${dto.provider}'`,
      );
    }
    await this.assertTarget(ctx.shopId, dto.productId, dto.variantId);
    await this.db.execute(
      `INSERT INTO channelitemmapping (shopId, provider, externalItemId, productId, variantId, externalName)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE productId = VALUES(productId), variantId = VALUES(variantId),
         externalName = COALESCE(VALUES(externalName), externalName)`,
      [
        ctx.shopId,
        dto.provider,
        dto.externalItemId,
        dto.productId,
        dto.variantId ?? null,
        dto.externalName ?? null,
      ],
    );
    return this.afterMapped(
      ctx,
      dto.provider,
      dto.externalItemId,
      dto.productId,
      dto.variantId,
    );
  }

  async remove(ctx: TenantContext, id: number) {
    const res = await this.db.execute(
      `DELETE FROM channelitemmapping WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (res.affectedRows === 0)
      throw new NotFoundException('Mapping not found');
    await this.audit.logCtx(ctx, {
      action: 'channel.mapping_deleted',
      entityType: 'channelitemmapping',
      entityId: id,
    });
    return { deleted: true };
  }

  // The queue the merchant works through: each unmapped item with the orders
  // that are waiting on it.
  async listUnmapped(ctx: TenantContext, includeResolved = false) {
    const items = await this.db.query<
      (ChannelunmappeditemRow & RowDataPacket)[]
    >(
      `SELECT * FROM channelunmappeditem
        WHERE shopId = ? ${includeResolved ? '' : 'AND resolvedAt IS NULL'}
        ORDER BY lastSeenAt DESC`,
      [ctx.shopId],
    );
    if (items.length === 0) return [];
    const waiting = await this.db.query<RowDataPacket[]>(
      `SELECT cu.unmappedItemId, co.id AS channelOrderId, co.displayId, co.externalOrderId, co.acceptBy, co.state
         FROM channelorderunmapped cu
         JOIN channelorder co ON co.id = cu.channelOrderId AND co.shopId = ?
        WHERE cu.unmappedItemId IN (${items.map(() => '?').join(', ')})`,
      [ctx.shopId, ...items.map((i) => i.id)],
    );
    return items.map((i) => ({
      ...i,
      waitingOrders: waiting
        .filter((w) => w.unmappedItemId === i.id && w.state === 'needs_mapping')
        .map((w) => ({
          channelOrderId: w.channelOrderId as number,
          displayId: w.displayId as string | null,
          externalOrderId: w.externalOrderId as string,
          acceptBy: w.acceptBy as Date | null,
        })),
    }));
  }

  // Resolving maps the item and re-evaluates every order that was waiting on it.
  async resolveUnmapped(
    ctx: TenantContext,
    id: number,
    dto: ResolveUnmappedItemDto,
  ) {
    const rows = await this.db.query<
      (ChannelunmappeditemRow & RowDataPacket)[]
    >(`SELECT * FROM channelunmappeditem WHERE id = ? AND shopId = ?`, [
      id,
      ctx.shopId,
    ]);
    const item = rows[0];
    if (!item) throw new NotFoundException('Unmapped item not found');
    return this.create(ctx, {
      provider: item.provider,
      externalItemId: item.externalItemId,
      externalName: item.externalName ?? undefined,
      productId: dto.productId,
      variantId: dto.variantId,
    });
  }

  private async afterMapped(
    ctx: TenantContext,
    provider: string,
    externalItemId: string,
    productId: number,
    variantId: number | undefined,
  ) {
    await this.db.execute(
      `UPDATE channelunmappeditem SET resolvedAt = ? WHERE shopId = ? AND provider = ? AND externalItemId = ?`,
      [new Date(), ctx.shopId, provider, externalItemId],
    );
    const ordersCreated = await this.ingestion.reevaluateWaiting(
      ctx.shopId,
      provider,
      [externalItemId],
    );
    await this.audit.logCtx(ctx, {
      action: 'channel.mapping_saved',
      entityType: 'channelitemmapping',
      after: {
        provider,
        externalItemId,
        productId,
        variantId: variantId ?? null,
        ordersCreated,
      },
    });
    return {
      provider,
      externalItemId,
      productId,
      variantId: variantId ?? null,
      ordersCreated,
    };
  }
}
