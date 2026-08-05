import request from 'supertest';
import type { App } from 'supertest/types';

// Publishing a shop now requires the acting admin's email to be verified
// (see ShopService.getPublishReadiness, Phase 3 auth lifecycle) — every
// e2e spec that signs up a shop and then publishes it needs to verify
// first. Centralized here rather than duplicated per-file since the same
// three lines were needed across ~20 otherwise-unrelated spec files.
export async function verifySignupEmail(
  app: App,
  devVerificationLink: string | undefined,
): Promise<void> {
  if (!devVerificationLink) return;
  const token = new URL(devVerificationLink).searchParams.get('token');
  await request(app).post('/auth/verify-email').send({ token }).expect(201);
}
