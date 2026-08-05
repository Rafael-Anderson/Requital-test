import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';
import { createLogger } from '../common/logging/logger';

const logger = createLogger('HealthController');

// Both endpoints are deliberately public-safe: `{ status: "ok" }` and
// nothing else, ever — no version string, no build hash, no env name, no
// stack trace on failure. An orchestrator's health probe (or anyone else on
// the internet, since these are unauthenticated by design) gets a plain
// signal and nothing about the deployment itself.
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  // Liveness: zero dependencies (no DB, no external call) — answers only
  // "is the process up and able to handle a request at all," which is what
  // an orchestrator uses to decide whether to kill/restart the container.
  // Mixing in a DB check here would make a transient DB blip restart a
  // perfectly healthy process — that's what /health/ready is for instead.
  @Public()
  @Get()
  liveness() {
    return { status: 'ok' };
  }

  // Readiness: a real query (SELECT 1), not a ping/connection-open check —
  // proves the app can actually round-trip a query against the configured
  // database right now, not just that a socket exists.
  @Public()
  @Get('ready')
  async readiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch (err) {
      logger.error('readiness check failed — database unreachable', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new ServiceUnavailableException({ status: 'error' });
    }
  }
}
