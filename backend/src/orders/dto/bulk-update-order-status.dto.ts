import { ArrayNotEmpty, ArrayMaxSize, IsArray, IsIn, IsInt, IsPositive } from 'class-validator';
import { ORDER_STATUSES } from '../constants';
import type { OrderStatus } from '../constants';

export class BulkUpdateOrderStatusDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  orderIds: number[];

  @IsIn(ORDER_STATUSES)
  status: OrderStatus;
}
