import { Controller, Get, Headers } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { DriverAppService } from './driver-app.service';

// The driver's mobile web app talks to this controller and nothing else. It is
// @Public (no staff, customer or platform session exists for a driver) and
// un-slugged: the link's own row says which shop, outlet, run and driver this is,
// so no shop slug or id is accepted from the client. The secret travels in the
// X-Driver-Token header (never a cookie, so no CSRF surface and no ambient
// credential; never a query string, so it stays out of access logs).
@Controller('driver-app')
export class DriverAppController {
  constructor(private readonly app: DriverAppService) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Get('run')
  getRun(@Headers('x-driver-token') token?: string) {
    return this.app.getRun(token);
  }
}
