import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ReturnsService } from './returns.service';
import { CreateReturnDto } from './dto/create-return.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

@Controller('orders/:orderId/returns')
export class ReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Roles('admin', 'branch', 'order_manager', 'viewer')
  @Get()
  findAll(
    @CurrentUser() ctx: TenantContext,
    @Param('orderId', ParseIntPipe) orderId: number,
  ) {
    return this.returnsService.findAllForOrder(ctx, orderId);
  }

  @Roles('admin', 'branch', 'order_manager')
  @Post()
  create(
    @CurrentUser() ctx: TenantContext,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: CreateReturnDto,
  ) {
    return this.returnsService.create(ctx, orderId, dto);
  }
}
