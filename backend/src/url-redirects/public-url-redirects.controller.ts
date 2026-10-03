import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { UrlRedirectsService } from './url-redirects.service';
import { LogNotFoundDto } from './dto/log-not-found.dto';
import { RecordRedirectHitsDto } from './dto/record-redirect-hits.dto';

// Unauthenticated, shop-scoped by the path slug like the rest of /public.
@Controller('public/:shopSlug')
export class PublicUrlRedirectsController {
  constructor(private readonly service: UrlRedirectsService) {}

  // One lookup, for callers that are not the storefront proxy. Empty 404 when
  // there is no (valid) redirect.
  @Public()
  @Get('redirects/resolve')
  async resolve(
    @Param('shopSlug') shopSlug: string,
    @Query('path') path?: string,
  ) {
    const resolved = await this.service.resolve(shopSlug, path ?? '');
    if (!resolved) throw new NotFoundException();
    return resolved;
  }

  // The shop's whole resolved map, ETag-versioned, for storefront/proxy.ts.
  // NOT throttled: its one legitimate caller is the storefront server itself,
  // so every request arrives from one IP (same reason as GET /domains/resolve).
  @Public()
  @Get('redirects/map')
  async map(
    @Param('shopSlug') shopSlug: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.getMap(shopSlug, ifNoneMatch);
    res.setHeader('ETag', result.etag);
    res.setHeader('Cache-Control', 'no-cache');
    if (result.notModified) {
      res.status(304);
      return;
    }
    return { hosts: result.hosts, entries: result.entries };
  }

  // Batched hit counts from the proxy. Advisory and spoofable (see the service).
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Public()
  @Post('redirects/hits')
  @HttpCode(204)
  async recordHits(
    @Param('shopSlug') shopSlug: string,
    @Body() dto: RecordRedirectHitsDto,
  ) {
    await this.service.recordHits(shopSlug, dto.hits);
  }

  // The storefront's not-found page reports here. Advisory and spoofable by
  // anyone: bounded by a per-IP throttle, a per-shop cap on distinct paths, and
  // storing nothing but a canonical path and a referrer host.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Public()
  @Post('404-log')
  @HttpCode(204)
  async logNotFound(
    @Param('shopSlug') shopSlug: string,
    @Body() dto: LogNotFoundDto,
  ) {
    await this.service.logNotFound(shopSlug, dto);
  }
}
