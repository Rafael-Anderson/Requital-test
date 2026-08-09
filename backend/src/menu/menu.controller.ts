import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { MenuService } from './menu.service';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { ReorderMenuItemsDto } from './dto/reorder-menu-items.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Admin-only end to end, same tier as Collections/Templates (catalog/theme
// structure, not a day-to-day operational surface).
@Roles('admin')
@Controller('menu-items')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  @Get()
  findAll(@CurrentUser() ctx: TenantContext) {
    return this.menuService.findAll(ctx);
  }

  // Placed before the :id route, same reason bio-links/collections
  // document: a numeric ParseIntPipe route would otherwise try (and fail)
  // to parse the literal 'reorder' segment as an id.
  @Patch('reorder')
  reorder(@CurrentUser() ctx: TenantContext, @Body() dto: ReorderMenuItemsDto) {
    return this.menuService.reorder(ctx, dto);
  }

  @Get(':id')
  findOne(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.menuService.findOne(ctx, id);
  }

  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateMenuItemDto) {
    return this.menuService.create(ctx, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMenuItemDto,
  ) {
    return this.menuService.update(ctx, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.menuService.remove(ctx, id);
  }
}
