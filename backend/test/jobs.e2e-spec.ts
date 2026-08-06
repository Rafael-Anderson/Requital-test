import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { JobsService } from '../src/jobs/jobs.service';
import { JobsWorkerService } from '../src/jobs/jobs.worker.service';
import { SchedulerService } from '../src/jobs/scheduler.service';

interface AuthResponse {
  accessToken: string;
}

function body<T>(res: Response): T {
  return res.body as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Phase 5 job queue — see JobsService/JobsWorkerService/SchedulerService.
// Deliberately drives JobsService's claim/fail/complete methods directly for
// the retry/DLQ tests rather than waiting on the real @Interval poller: the
// poller is disabled under NODE_ENV=test (see JobsWorkerService.tick) so it
// can't race these assertions, and calling the exact same methods the
// poller itself calls (claimNextJob/failJob/completeJob) tests the real
// mechanism, not a re-implementation of it.
//
// The "worker end-to-end wiring" test drives jobsWorker.pollOnce() in a
// bounded loop against the real, shared job table — under the full e2e
// suite (Jest runs every spec file in parallel, each enqueueing its own
// jobs) that loop can take longer than Jest's 5s default per test.
jest.setTimeout(20000);

describe('Job queue (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jobsService: JobsService;
  let jobsWorker: JobsWorkerService;
  let schedulerService: SchedulerService;
  const runId = Date.now();

  let shopAId: number;
  let shopAAdminToken: string;
  let shopBAdminToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    jobsService = app.get(JobsService);
    jobsWorker = app.get(JobsWorkerService);
    schedulerService = app.get(SchedulerService);

    async function setupShop(slugPrefix: string) {
      const shopSlug = `${slugPrefix}-${runId}`;
      const signup = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          name: 'Shop Admin',
          email: `${shopSlug}@test.com`,
          password: 'password123',
          shopName: `${shopSlug} Shop`,
          subdomain: shopSlug,
        })
        .expect(201);
      const shop = await prisma.shop.findUniqueOrThrow({
        where: { subdomain: shopSlug },
      });
      return {
        shopId: shop.id,
        token: body<AuthResponse>(signup).accessToken,
      };
    }

    const a = await setupShop('jobs-shop-a');
    shopAId = a.shopId;
    shopAAdminToken = a.token;
    const b = await setupShop('jobs-shop-b');
    shopBAdminToken = b.token;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('enqueue — idempotency and shopId validation', () => {
    it('rejects a job with no/invalid shopId at enqueue time, before any row is written', async () => {
      await expect(
        jobsService.enqueue(
          0,
          'send_email',
          { to: 'a@b.com', subject: 's', bodyText: 'b' },
          `adversarial-no-shop-${runId}`,
        ),
      ).rejects.toThrow();

      const count = await prisma.job.count({
        where: { idempotencyKey: `adversarial-no-shop-${runId}` },
      });
      expect(count).toBe(0);
    });

    it('enqueuing the same idempotencyKey twice runs the underlying job exactly once', async () => {
      const key = `idem-test-${runId}`;
      const payload = { to: 'a@b.com', subject: 's', bodyText: 'b' };

      const first = await jobsService.enqueue(
        shopAId,
        'send_email',
        payload,
        key,
      );
      const second = await jobsService.enqueue(
        shopAId,
        'send_email',
        payload,
        key,
      );

      expect(second.id).toBe(first.id);
      const rows = await prisma.job.findMany({
        where: { idempotencyKey: key },
      });
      expect(rows).toHaveLength(1);
    });
  });

  describe('retry with exponential backoff', () => {
    it('a job that fails N-1 times succeeds on attempt N', async () => {
      const key = `retry-success-${runId}`;
      const enqueued = await jobsService.enqueue(
        shopAId,
        'send_email',
        { to: 'a@b.com', subject: 's', bodyText: 'b' },
        key,
        { maxAttempts: 3 },
      );

      // Attempt 1: claim, fail.
      let claimed = await jobsService.claimJobById(enqueued.id);
      expect(claimed?.attempts).toBe(1);
      await jobsService.failJob(enqueued.id, 'transient failure 1');
      let row = await prisma.job.findUniqueOrThrow({
        where: { id: enqueued.id },
      });
      expect(row.status).toBe('pending');
      expect(row.attempts).toBe(1);

      // Attempt 2: claim (forcing nextAttemptAt so the backoff delay doesn't
      // block the claim in this test), fail again.
      await prisma.job.update({
        where: { id: enqueued.id },
        data: { nextAttemptAt: new Date() },
      });
      claimed = await jobsService.claimJobById(enqueued.id);
      expect(claimed?.attempts).toBe(2);
      await jobsService.failJob(enqueued.id, 'transient failure 2');
      row = await prisma.job.findUniqueOrThrow({ where: { id: enqueued.id } });
      expect(row.status).toBe('pending');
      expect(row.attempts).toBe(2);

      // Attempt 3: succeeds.
      await prisma.job.update({
        where: { id: enqueued.id },
        data: { nextAttemptAt: new Date() },
      });
      claimed = await jobsService.claimJobById(enqueued.id);
      expect(claimed?.attempts).toBe(3);
      await jobsService.completeJob(enqueued.id);

      row = await prisma.job.findUniqueOrThrow({ where: { id: enqueued.id } });
      expect(row.status).toBe('completed');
      expect(row.attempts).toBe(3);
      expect(row.completedAt).not.toBeNull();
    });

    it('failing pushes nextAttemptAt forward — the job is not immediately reclaimable', async () => {
      const key = `retry-backoff-delay-${runId}`;
      const enqueued = await jobsService.enqueue(
        shopAId,
        'send_email',
        { to: 'a@b.com', subject: 's', bodyText: 'b' },
        key,
      );
      await jobsService.claimJobById(enqueued.id);
      const before = Date.now();
      await jobsService.failJob(enqueued.id, 'boom');

      const row = await prisma.job.findUniqueOrThrow({
        where: { id: enqueued.id },
      });
      expect(row.nextAttemptAt.getTime()).toBeGreaterThan(before);
    });
  });

  describe('job failure -> dead-letter', () => {
    it('a job that fails maxAttempts times lands in dead_letter and is never retried further', async () => {
      const key = `dlq-test-${runId}`;
      const enqueued = await jobsService.enqueue(
        shopAId,
        'send_email',
        { to: 'a@b.com', subject: 's', bodyText: 'b' },
        key,
        { maxAttempts: 2 },
      );

      await jobsService.claimJobById(enqueued.id);
      await jobsService.failJob(enqueued.id, 'failure 1');
      await prisma.job.update({
        where: { id: enqueued.id },
        data: { nextAttemptAt: new Date() },
      });
      await jobsService.claimJobById(enqueued.id);
      await jobsService.failJob(enqueued.id, 'failure 2 — final');

      const row = await prisma.job.findUniqueOrThrow({
        where: { id: enqueued.id },
      });
      expect(row.status).toBe('dead_letter');
      expect(row.lastError).toBe('failure 2 — final');

      // Never retried further: it no longer matches the pending-jobs claim
      // query at all, regardless of nextAttemptAt.
      await prisma.job.update({
        where: { id: enqueued.id },
        data: { nextAttemptAt: new Date(0) },
      });
      const stillPending = await prisma.job.findFirst({
        where: { id: enqueued.id, status: 'pending' },
      });
      expect(stillPending).toBeNull();
    });
  });

  describe('worker end-to-end wiring', () => {
    it('processJobById() claims and completes a real send_email job (stub mode)', async () => {
      const key = `worker-e2e-${runId}`;
      const enqueued = await jobsService.enqueue(
        shopAId,
        'send_email',
        { to: 'a@b.com', subject: 'wired?', bodyText: 'yes' },
        key,
      );

      // processJobById (not the generic pollOnce()) — under the full e2e
      // suite, every other spec file's own process is enqueueing and
      // draining jobs concurrently against the same shared table (Jest runs
      // spec files in parallel processes, see JobsWorkerService's own
      // comment on why this matters); pollOnce()'s "whatever's globally
      // next due" claim made this test's own runtime depend on how large
      // that shared backlog happened to be at the moment it ran, which
      // measurably (not just theoretically) exceeded a 20s budget under
      // real load. Targeting this job's own id tests the exact same
      // dispatch path (processJobById calls the same private processJob()
      // pollOnce() does) without that dependency.
      const processed = await jobsWorker.processJobById(enqueued.id);
      expect(processed).toBe(true);

      const row = await prisma.job.findUniqueOrThrow({
        where: { id: enqueued.id },
      });
      expect(row.status).toBe('completed');
    });
  });

  describe('admin failed-jobs visibility — tenant isolation', () => {
    it("a dead-letter job for shop A never appears in shop B's failed-jobs list, and shop B cannot retry/dismiss it", async () => {
      const key = `cross-tenant-dlq-${runId}`;
      const enqueued = await jobsService.enqueue(
        shopAId,
        'send_email',
        { to: 'a@b.com', subject: 's', bodyText: 'b' },
        key,
        { maxAttempts: 1 },
      );
      await jobsService.claimJobById(enqueued.id);
      await jobsService.failJob(enqueued.id, 'dead on first failure');

      const dlqRow = await prisma.job.findUniqueOrThrow({
        where: { id: enqueued.id },
      });
      expect(dlqRow.status).toBe('dead_letter');

      // Shop A sees it.
      const listA = await request(app.getHttpServer())
        .get('/jobs/failed')
        .set('Authorization', `Bearer ${shopAAdminToken}`)
        .expect(200);
      expect(
        body<{ id: number }[]>(listA).some((j) => j.id === enqueued.id),
      ).toBe(true);

      // Shop B does not.
      const listB = await request(app.getHttpServer())
        .get('/jobs/failed')
        .set('Authorization', `Bearer ${shopBAdminToken}`)
        .expect(200);
      expect(
        body<{ id: number }[]>(listB).some((j) => j.id === enqueued.id),
      ).toBe(false);

      // Shop B cannot retry it (404, not a silent cross-tenant success).
      await request(app.getHttpServer())
        .post(`/jobs/${enqueued.id}/retry`)
        .set('Authorization', `Bearer ${shopBAdminToken}`)
        .expect(404);

      // Shop B cannot dismiss it either.
      await request(app.getHttpServer())
        .delete(`/jobs/${enqueued.id}`)
        .set('Authorization', `Bearer ${shopBAdminToken}`)
        .expect(404);

      // The row is untouched by shop B's rejected attempts.
      const stillDlq = await prisma.job.findUniqueOrThrow({
        where: { id: enqueued.id },
      });
      expect(stillDlq.status).toBe('dead_letter');

      // Shop A can retry its own job.
      await request(app.getHttpServer())
        .post(`/jobs/${enqueued.id}/retry`)
        .set('Authorization', `Bearer ${shopAAdminToken}`)
        .expect(201);
      const retried = await prisma.job.findUniqueOrThrow({
        where: { id: enqueued.id },
      });
      expect(retried.status).toBe('pending');
      expect(retried.attempts).toBe(0);
    });
  });

  describe('scheduler cross-instance lock', () => {
    it('two racing calls for the same schedule name run the locked function exactly once', async () => {
      const lockName = `test-sweep-${runId}`;
      let callCount = 0;

      await Promise.all([
        schedulerService.runLocked(lockName, 30, async () => {
          callCount += 1;
          await sleep(100);
        }),
        schedulerService.runLocked(lockName, 30, async () => {
          callCount += 1;
          await sleep(100);
        }),
      ]);

      expect(callCount).toBe(1);
    });

    it('a later call for the same name can run again once the lock is released', async () => {
      const lockName = `test-sweep-sequential-${runId}`;
      let callCount = 0;

      await schedulerService.runLocked(lockName, 30, () => {
        callCount += 1;
        return Promise.resolve();
      });
      await schedulerService.runLocked(lockName, 30, () => {
        callCount += 1;
        return Promise.resolve();
      });

      expect(callCount).toBe(2);
    });
  });
});
