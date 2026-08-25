import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformLoginDto } from './dto/platform-login.dto';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { CurrentPlatformAdmin } from './decorators/current-platform-admin.decorator';
import type { PlatformAdminContext } from './guards/platform-admin.guard';
import { Public } from '../auth/decorators/public.decorator';

// @Public() at class level opts every route here out of the GLOBAL merchant
// AuthGuard (an APP_GUARD, so it otherwise runs in front of every
// controller in the app, this one included). Real protection for the
// non-login routes below comes from @UseGuards(PlatformAdminGuard) instead
// — a completely separate guard/JWT scope, not "no auth at all". Same
// two-layer shape the old PlatformAdminController used with @Public() +
// its shared-secret check, just with a real guard now.
@Public()
@Controller('platform-auth')
export class PlatformAuthController {
  constructor(private readonly platformAuthService: PlatformAuthService) {}

  // Aggressively rate-limited, tighter than merchant login's already-tight
  // 5/min — this endpoint gates access to every shop on the platform, not
  // one shop. Paired with PlatformAuthService's own per-account progressive
  // lockout for the distributed-attacker case a per-IP limit alone misses.
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('login')
  login(@Body() dto: PlatformLoginDto) {
    return this.platformAuthService.login(dto);
  }

  // Lets the platform admin frontend hydrate/validate a stored session on
  // mount, mirroring GET /auth/me's role for the merchant app.
  @UseGuards(PlatformAdminGuard)
  @Get('me')
  me(@CurrentPlatformAdmin() admin: PlatformAdminContext) {
    return admin;
  }
}
