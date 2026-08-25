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

  // Public counterpart of the private findByOrderId below — used by
  // SliderDeliveryService to check whether an order already has a delivery
  // logged (manual or Slider) before dispatching a new one, and by the
  // Slider webhook job handler to resolve which row a status update
  // belongs to.
  async findByOrderIdOrNull(orderId: number) {
    return this.findByOrderId(orderId);
  }

  // Slider-specific insert — same table, same one-per-order uniqueness as
  // the manual create() above (relies on the same ExternalDelivery_orderId_key
  // unique index / isDuplicateKeyError handling), just with the extra
  // provider-tracking columns manual logging never populates.
  async createSliderDelivery(
    orderId: number,
    data: {
      vehicleType: string;
      price: number;
      destination: string;
      status: string;
      sliderOrderNumber: number;
      trackingUrl: string;
    },
  ) {
    try {
      const result = await this.db.execute(
        `INSERT INTO externaldelivery
           (orderId, carrier, vehicleType, price, destination, status, provider, sliderOrderNumber, trackingUrl)
         VALUES (?, 'Slider', ?, ?, ?, ?, 'slider', ?, ?)`,
        [
          orderId,
          data.vehicleType,
          data.price,
          data.destination,
          data.status,
          data.sliderOrderNumber,
          data.trackingUrl,
        ],
      );
      return this.findById(result.insertId);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'This order already has an external delivery logged',
        );
      }
      throw error;
    }
  }

  // Webhook-driven update — a plain SET clause, not CAS: Slider's own
  // status transitions are the source of truth here, there's no concurrent
  // local writer to race against the way order.status has.
  async updateSliderDeliveryByOrderNumber(
    sliderOrderNumber: number,
    data: {
      status?: string;
      driverName?: string | null;
      driverPhone?: string | null;
      driverLat?: number | null;
      driverLng?: number | null;
      trackingUrl?: string;
      estimatedDeliveryMinutes?: number | null;
    },
  ) {
    const set = buildSetClause(data);
    if (!set) return;
    await this.db.execute(
      `UPDATE externaldelivery SET ${set.setClause} WHERE sliderOrderNumber = ?`,
      [...set.params, sliderOrderNumber],
    );
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
