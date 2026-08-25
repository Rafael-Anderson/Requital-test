import {
  Body,
  Controller,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
} from '@nestjs/common';
import { SliderSettingsService } from '../delivery-providers/slider-settings.service';
import { SetSliderAccountIdDto } from '../delivery-providers/dto/set-slider-account-id.dto';
import { Public } from '../auth/decorators/public.decorator';
import { assertPlatformAdminToken } from '../common/platform-admin-auth';

// @Public() — bypasses the shop-scoped AuthGuard entirely; auth here is the
// X-Platform-Admin-Token header instead (see assertPlatformAdminToken).
// This is the ONLY route in this controller today: setting a shop's Slider
// customer account id, since a merchant has no access to Slider's own
// dashboard to get that value themselves (see SliderSettingsService's own
// comment). No general platform-admin UI/role exists yet — this is
// API-only, called by hand (curl/Postman) until one does. See CLAUDE.md.
@Public()
@Controller('platform-admin')
export class PlatformAdminController {
  constructor(private readonly sliderSettingsService: SliderSettingsService) {}

  @Patch('shops/:shopId/slider-account-id')
  setSliderAccountId(
    @Headers('x-platform-admin-token') token: string | undefined,
    @Param('shopId', ParseIntPipe) shopId: number,
    @Body() dto: SetSliderAccountIdDto,
  ) {
    assertPlatformAdminToken(token);
    return this.sliderSettingsService.setAccountId(shopId, dto.accountId);
  }
}
