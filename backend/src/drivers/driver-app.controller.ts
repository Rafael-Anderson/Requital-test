import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PROOF_MAX_BYTES } from '../storage/storage.service';
import { DeliverStopDto, FailStopDto } from './dto/driver-app.dto';
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

  @Public()
  @Throttle({ default: { limit: 6, ttl: 60000 } })
  @Post('stops/:stopId/code')
  sendCode(
    @Headers('x-driver-token') token: string | undefined,
    @Param('stopId', ParseIntPipe) stopId: number,
  ) {
    return this.app.sendCode(token, stopId);
  }

  @Public()
  @Throttle({ default: { limit: 12, ttl: 60000 } })
  @Post('stops/:stopId/photo')
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: memoryStorage(),
      limits: { fileSize: PROOF_MAX_BYTES, files: 1, fields: 0, parts: 2 },
    }),
  )
  uploadPhoto(
    @Headers('x-driver-token') token: string | undefined,
    @Param('stopId', ParseIntPipe) stopId: number,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.app.uploadPhoto(token, stopId, file);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('stops/:stopId/deliver')
  deliver(
    @Headers('x-driver-token') token: string | undefined,
    @Param('stopId', ParseIntPipe) stopId: number,
    @Body() dto: DeliverStopDto,
  ) {
    return this.app.deliver(token, stopId, dto);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('stops/:stopId/fail')
  fail(
    @Headers('x-driver-token') token: string | undefined,
    @Param('stopId', ParseIntPipe) stopId: number,
    @Body() dto: FailStopDto,
  ) {
    return this.app.fail(token, stopId, dto);
  }
}
