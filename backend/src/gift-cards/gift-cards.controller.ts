import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { GiftCardsService } from './gift-cards.service';
import { CreateGiftCardDto } from './dto/create-gift-card.dto';
import { UpdateGiftCardDto } from './dto/update-gift-card.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Admin-only — issuing/disabling gift cards is a financial-instrument
// action, same tier as Discounts CRUD.
@Roles('admin')
@Controller('gift-cards')
export class GiftCardsController {
  constructor(private readonly giftCardsService: GiftCardsService) {}

  @Get()
  findAll(@CurrentUser() ctx: TenantContext) {
    return this.giftCardsService.findAll(ctx);
  }

  @Get(':id')
  findOne(@CurrentUser() ctx: TenantContext, @Param('id', ParseIntPipe) id: number) {
    return this.giftCardsService.findOne(ctx, id);
  }

  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateGiftCardDto) {
    return this.giftCardsService.create(ctx, dto);
  }

  @Patch(':id')
  update(@CurrentUser() ctx: TenantContext, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateGiftCardDto) {
    return this.giftCardsService.update(ctx, id, dto);
  }
}
