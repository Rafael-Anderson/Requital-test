import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Reads (admin + viewer) vs writes (admin-only) split at the method level —
// not just the writes are restricted. Customers are shop-wide (not
// outlet-scoped, unlike orders/products/stock), so there's no natural
// "branch user sees only their own slice" boundary the way outlet-scoped
// data has one; a branch account seeing every customer across every branch
// would leak more than their own outlet's activity. Default choice, flagged
// per the task rather than assumed — revisit if branch staff turn out to
// need read access to customers tied to their own outlet's orders.
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Roles('admin', 'viewer')
  @Get()
  findAll(@CurrentUser() ctx: TenantContext, @Query() query: ListCustomersQueryDto) {
    return this.customersService.findAll(ctx, query);
  }

  @Roles('admin', 'viewer')
  @Get(':id')
  findOne(@CurrentUser() ctx: TenantContext, @Param('id', ParseIntPipe) id: number) {
    return this.customersService.findOne(ctx, id);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(ctx, id, dto);
  }
}
