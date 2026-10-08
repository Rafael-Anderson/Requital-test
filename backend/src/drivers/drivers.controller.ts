import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { DriversService } from './drivers.service';
import {
  CreateDriverDto,
  ListDriversQueryDto,
  UpdateDriverDto,
} from './dto/driver.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// admin (every outlet) and branch (own outlet only). order_manager and viewer
// have no driver access. The service pins a branch user to its outlet and the
// per-outlet permission layer applies on top.
@Roles('admin', 'branch')
@Controller('drivers')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Get()
  findAll(
    @CurrentUser() ctx: TenantContext,
    @Query() query: ListDriversQueryDto,
  ) {
    return this.drivers.findAll(ctx, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.drivers.findOne(ctx, id);
  }

  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateDriverDto) {
    return this.drivers.create(ctx, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDriverDto,
  ) {
    return this.drivers.update(ctx, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.drivers.remove(ctx, id);
  }
}
