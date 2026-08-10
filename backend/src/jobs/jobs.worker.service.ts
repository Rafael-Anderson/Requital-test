import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { JobsService, type JobRecord } from './jobs.service';
import { createLogger } from '../common/logging/logger';
import { handleSendEmailJob } from './handlers/send-email.handler';
import { handleSendMerchantWhatsAppAlertJob } from './handlers/send-merchant-whatsapp-alert.handler';
import type {
  JobPayload,
  JobType,
  SendEmailJobPayload,
  SendMerchantWhatsAppAlertJobPayload,
} from './jobs.types';

const logger = createLogger('JobsWorker');
const POLL_INTERVAL_MS = 5000;
// ponytail: fixed per-tick cap rather than draining the whole due-queue in
// one tick — bounds how long a single @Interval tick can run. Raise (or
// switch to a real drain loop) if throughput ever measurably falls short.
const MAX_JOBS_PER_TICK = 10;

// Each handler is only ever invoked with the payload shape matching its own
// job.type (processJob below looks the handler up by that same type), so
// the per-branch cast here is safe despite JobPayload being a union.
const HANDLERS: Record<JobType, (payload: JobPayload) => Promise<void>> = {
  send_email: (payload) => handleSendEmailJob(payload as SendEmailJobPayload),
  send_merchant_whatsapp_alert: (payload) =>
    handleSendMerchantWhatsAppAlertJob(
      payload as SendMerchantWhatsAppAlertJobPayload,
    ),
};

// Polls the `job` table on an interval and executes whatever's due — see
// JobsService.claimNextJob for the SKIP LOCKED claim that makes this safe
// across multiple app instances. @Interval, not @Cron, since this needs to
// run every few seconds rather than at a calendar-aligned time; both come
// from the same already-registered ScheduleModule (see app.module.ts).
@Injectable()
export class JobsWorkerService {
  constructor(private readonly jobsService: JobsService) {}

  // Every e2e spec bootstraps the real AppModule (see CLAUDE.md), so a live
  // 5s-interval poller would otherwise run inside every one of those specs'
  // app instances — racing jobs.e2e-spec.ts's own manual claim/fail/complete
  // assertions, and (with ~50 spec files, some run in parallel) doing
  // unrequested background work in every other spec too. Same
  // skip-under-test idiom as ThrottlerModule's skipIf in app.module.ts.
  // pollOnce() itself stays unguarded so tests can still drive a real,
  // deterministic poll tick by calling it directly.
  @Interval(POLL_INTERVAL_MS)
  async tick(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.pollOnce();
  }

  // Returns how many jobs it actually processed this tick — the live
  // @Interval caller ignores it, but jobs.e2e-spec.ts and other e2e specs
  // use it to drain the full due-queue deterministically (loop until 0)
  // rather than guessing how many calls a given backlog needs.
  // Test-oriented: process one specific job, by id, in THIS process — rather
  // than pollOnce()'s "whatever's globally next due" claim. Needed by e2e
  // specs that must observe a side effect (a fetch/console.log spy) which
  // only fires in the process that actually executes the handler: Jest runs
  // each e2e spec file in its own OS process, so pollOnce()'s claim query
  // has no process affinity and can just as easily be won by a different
  // spec file's own worker racing the same shared job table — whose side
  // effects this process's spies could then never observe. Returns false
  // (a no-op) if the job isn't claimable right now (already
  // claimed/processing elsewhere, not yet due, or doesn't exist).
  async processJobById(id: number): Promise<boolean> {
    const job = await this.jobsService.claimJobById(id);
    if (!job) return false;
    await this.processJob(job);
    return true;
  }

  async pollOnce(): Promise<number> {
    let processed = 0;
    for (let i = 0; i < MAX_JOBS_PER_TICK; i++) {
      const job = await this.jobsService.claimNextJob();
      if (!job) return processed;
      await this.processJob(job);
      processed += 1;
    }
    return processed;
  }

  private async processJob(job: JobRecord): Promise<void> {
    const handler = HANDLERS[job.type as JobType];
    if (!handler) {
      await this.jobsService.failJob(
        job.id,
        `no handler registered for job type "${job.type}"`,
      );
      return;
    }
    try {
      await handler(job.payload as unknown as JobPayload);
      await this.jobsService.completeJob(job.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        `job ${job.id} (${job.type}) failed on attempt ${job.attempts}`,
        {
          jobId: job.id,
          type: job.type,
          shopId: job.shopId,
          attempts: job.attempts,
          error: message,
        },
      );
      await this.jobsService.failJob(job.id, message);
    }
  }
}
