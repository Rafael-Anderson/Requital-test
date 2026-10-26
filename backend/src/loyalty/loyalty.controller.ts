import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';
import { LoyaltyService } from './loyalty.service';
import { AdjustLoyaltyDto, SaveLoyaltyProgramDto } from './dto/loyalty.dto';

// Role decision (same evidence as store credit): points convert to money, and
// customers are shop-wide with no outlet boundary, so 'branch' and
// 'order_manager' get nothing here. Reads of a customer's ledger: admin + viewer;
// the program and every write: admin only.
@Controller('loyalty')
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Roles('admin')
  @Get('program')
  getProgram(@CurrentUser() ctx: TenantContext) {
    return this.loyalty.getProgram(ctx.shopId);
  }

  @Roles('admin')
  @Put('program')
  saveProgram(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: SaveLoyaltyProgramDto,
  ) {
    return this.loyalty.saveProgram(ctx, dto);
  }
}

@Controller('customers/:id/loyalty')
export class CustomerLoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Roles('admin', 'viewer')
  @Get()
  overview(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.loyalty.customerOverview(ctx.shopId, id);
  }

  @Roles('admin')
  @Post('adjustments')
  adjust(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdjustLoyaltyDto,
  ) {
    return this.loyalty.adjust(ctx, id, dto);
  }
}
