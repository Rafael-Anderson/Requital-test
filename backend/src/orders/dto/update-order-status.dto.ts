import { IsIn } from 'class-validator';
import { ORDER_STATUSES } from '../constants';
import type { OrderStatus } from '../constants';

export class UpdateOrderStatusDto {
  @IsIn(ORDER_STATUSES)
  status: OrderStatus;
}
