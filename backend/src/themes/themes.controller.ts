import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { ThemesService } from './themes.service';
import { CreateThemeDto } from './dto/create-theme.dto';
import { UpdateThemeDraftDto } from './dto/update-theme-draft.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Deliberately separate (plural `themes`) from the pre-existing singular
// `theme/` module, which keeps governing the legacy themesettings-backed
// site-settings/appearance-color/advanced tabs untouched — see
// ThemesService's own header comment. Admin-only, same reasoning as
// ThemeController: storefront branding is a business-level decision, not a
// branch-level one. Available to every shop immediately — not gated behind
// shop.dynamicThemeBuilderEnabled or any other flag.
@Roles('admin')
@Controller('themes')
export class ThemesController {
  constructor(private readonly themesService: ThemesService) {}

  @Get()
  list(@CurrentUser() ctx: TenantContext) {
    return this.themesService.list(ctx);
  }

  @Get(':id')
  findOne(@CurrentUser() ctx: TenantContext, @Param('id', ParseIntPipe) id: number) {
    return this.themesService.findOne(ctx, id);
  }

  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateThemeDto) {
    return this.themesService.create(ctx, dto);
  }

  @Patch(':id')
  updateDraft(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateThemeDraftDto,
  ) {
    return this.themesService.updateDraft(ctx, id, dto);
  }

  @Post(':id/publish')
  publish(@CurrentUser() ctx: TenantContext, @Param('id', ParseIntPipe) id: number) {
    return this.themesService.publish(ctx, id);
  }

  @Delete(':id')
  remove(@CurrentUser() ctx: TenantContext, @Param('id', ParseIntPipe) id: number) {
    return this.themesService.remove(ctx, id);
  }
}
