// Throttling is skipped wholesale under Jest: dozens of e2e specs
// legitimately call /auth/signup or /auth/login many times in quick
// succession from one in-process supertest client, and 429s there would have
// nothing to do with what those tests check. THROTTLE_IN_TESTS=1 is a
// test-only seam that can only ever re-ENABLE throttling, never disable it
// in production - test/signup-limits.e2e-spec.ts uses it to watch the signup
// limits actually reject a request. Shared by the Throttler (app.module.ts)
// and the code-guess limiter (code-guess-limiter.ts).
export function skipThrottling(): boolean {
  return (
    process.env.NODE_ENV === 'test' && process.env.THROTTLE_IN_TESTS !== '1'
  );
}
