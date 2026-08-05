// TEMPORARY — CI Phase 2 negative-control test. Deliberately introduces one
// outlet-scoping guardrail violation and one new lint error, to prove both
// checks actually fail the build. Will be deleted in the very next commit.
import type { TenantContext } from './common/tenant-context';

export class ScratchCiNegativeTestService {
  async unguardedOutletWrite(ctx: TenantContext, outletId: number) {
    // Deliberately no ownership check — this is the bug class
    // check-outlet-scoping.js exists to catch.
    return { shopId: ctx.shopId, outletId };
  }

  triggerLintRatchet(): number {
    const neverUsed = 42;
    return 1;
  }
}
