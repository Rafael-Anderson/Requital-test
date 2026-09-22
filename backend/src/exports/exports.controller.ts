import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { TenantContext } from '../common/tenant-context';
import { DatabaseService } from '../database/database.service';
import { resolveOutletFilter } from '../common/outlet-scope';
import { createLogger } from '../common/logging/logger';
import { toCsvLine, UTF8_BOM } from './csv';
import { EXPORT_DEFINITIONS } from './export-definitions';
import { ExportQueryDto } from './dto/export-query.dto';

const logger = createLogger('Exports');

// Rows fetched per round trip. Large enough that a 50k-row export is not 50k
// queries, small enough that no single page is held in memory for long.
const PAGE_SIZE = 500;

// A hard stop so one export cannot pin a worker indefinitely on a pathological
// shop. 500k rows is far past any real merchant's catalogue or order history;
// hitting it means something is wrong, so it is logged rather than silently
// truncating a file that looks complete.
const MAX_ROWS = 500_000;

@Controller('exports')
export class ExportsController {
  constructor(private readonly db: DatabaseService) {}

  // Streamed rather than built in memory: the bug this replaces is an export
  // that only contained the page currently on screen, so these responses are
  // now unbounded by design and a 50k-row customer list must not be
  // materialised as one string before the first byte is sent.
  //
  // @Roles here is the coarse gate (any authenticated staff role); each
  // definition then declares its own narrower role list, checked below. The
  // kind is looked up in a closed record, never interpolated into SQL.
  @Get(':kind')
  @Roles('admin', 'viewer', 'order_manager', 'branch')
  async export(
    @CurrentUser() ctx: TenantContext,
    @Param('kind') kind: string,
    @Query() query: ExportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const definition = Object.prototype.hasOwnProperty.call(
      EXPORT_DEFINITIONS,
      kind,
    )
      ? EXPORT_DEFINITIONS[kind]
      : undefined;
    // 404 rather than 400: an unknown kind is an unknown route as far as the
    // caller is concerned, and this way the error shape matches a typo in the
    // path either side of the colon.
    if (!definition) throw new NotFoundException('Unknown export');

    if (!definition.roles.includes(ctx.role)) {
      throw new ForbiddenException('Not allowed to export this report');
    }

    // Same forcing rule every outlet-scoped read goes through: a branch user's
    // own outlet always wins over whatever the query string asked for.
    const outletId = resolveOutletFilter(ctx, query.outletId);

    const filename = `${definition.filenamePrefix}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;

    // The FIRST page is fetched before any header is sent, deliberately. Once
    // a byte of the body is on the wire the status code is fixed, so a query
    // that throws mid-stream can only abort the connection - which a browser
    // may present as a partially-downloaded file that looks like a valid CSV.
    // Fetching page one first means the overwhelmingly likely failure (a bad
    // query, a permission problem) still becomes an ordinary 500 with a JSON
    // body, exactly like every other endpoint.
    let offset = 0;
    let page = await definition.fetchPage(
      { db: this.db, ctx, outletId, search: query.search },
      PAGE_SIZE,
      offset,
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // The row count is not known up front (that is what streaming buys), so
    // there is deliberately no Content-Length and the response is chunked.
    res.setHeader('Cache-Control', 'no-store');

    res.write(UTF8_BOM + toCsvLine(definition.headers));

    let written = 0;
    for (;;) {
      const rows = page;
      if (rows.length === 0) break;

      res.write(rows.map(toCsvLine).join(''));
      written += rows.length;
      offset += PAGE_SIZE;

      if (written >= MAX_ROWS) {
        logger.error('export hit the row cap and was truncated', {
          shopId: ctx.shopId,
          kind,
          written,
        });
        break;
      }
      // A page shorter than requested means the source is exhausted.
      if (rows.length < PAGE_SIZE) break;

      // A later page failing cannot become a 500 any more, so it is logged and
      // the connection is destroyed rather than ended cleanly: an abrupt close
      // on a chunked response is detectable by the client, whereas res.end()
      // would hand over a truncated file that looks complete.
      try {
        page = await definition.fetchPage(
          { db: this.db, ctx, outletId, search: query.search },
          PAGE_SIZE,
          offset,
        );
      } catch (err) {
        logger.error('export failed after streaming began', {
          shopId: ctx.shopId,
          kind,
          written,
          error: err instanceof Error ? err.message : String(err),
        });
        res.destroy();
        return;
      }
    }

    res.end();
  }
}
