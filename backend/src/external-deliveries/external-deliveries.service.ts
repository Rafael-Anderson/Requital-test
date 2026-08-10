import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { buildSetClause } from '../database/update.util';
import { isDuplicateKeyError } from '../database/mysql-errors';
import type { RowDataPacket } from 'mysql2/promise';
import type { ExternaldeliveryRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { CreateExternalDeliveryDto } from './dto/create-external-delivery.dto';
import { UpdateExternalDeliveryDto } from './dto/update-external-delivery.dto';

@Injectable()
export class ExternalDeliveriesService {
  constructor(private readonly db: DatabaseService) {}

  async create(
    ctx: TenantContext,
    orderId: number,
    dto: CreateExternalDeliveryDto,
  ) {
    await this.assertOrderBelongsToShop(ctx, orderId);
    try {
      const result = await this.db.execute(
        `INSERT INTO externaldelivery (orderId, carrier, vehicleType, price, destination, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          dto.carrier,
          dto.vehicleType ?? null,
          dto.price,
          dto.destination,
          dto.status ?? 'pending',
        ],
      );
      return this.findById(result.insertId);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        // One record per order, by design — see the schema comment.
        throw new ConflictException(
          'This order already has an external delivery logged',
        );
      }
      throw error;
    }
  }

  async update(
    ctx: TenantContext,
    orderId: number,
    dto: UpdateExternalDeliveryDto,
  ) {
    await this.assertOrderBelongsToShop(ctx, orderId);
    const existing = await this.findByOrderId(orderId);
    if (!existing) {
      throw new NotFoundException(
        'No external delivery logged for this order yet',
      );
    }
    const set = buildSetClause({
      status: dto.status,
      carrier: dto.carrier,
      vehicleType: dto.vehicleType,
      price: dto.price,
      destination: dto.destination,
    });
    if (set) {
      await this.db.execute(
        `UPDATE externaldelivery SET ${set.setClause} WHERE orderId = ?`,
        [...set.params, orderId],
      );
    }
    return this.findByOrderId(orderId);
  }

  private async findById(id: number) {
    const rows = await this.db.query<(ExternaldeliveryRow & RowDataPacket)[]>(
      `SELECT * FROM externaldelivery WHERE id = ?`,
      [id],
    );
    return rows[0];
  }

  private async findByOrderId(orderId: number) {
    const rows = await this.db.query<(ExternaldeliveryRow & RowDataPacket)[]>(
      `SELECT * FROM externaldelivery WHERE orderId = ?`,
      [orderId],
    );
    return rows[0];
  }

  private async assertOrderBelongsToShop(ctx: TenantContext, orderId: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM \`order\` WHERE id = ? AND shopId = ?`,
      [orderId, ctx.shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
  }
}
