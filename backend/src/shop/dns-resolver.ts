import { Injectable } from '@nestjs/common';
import { resolveTxt } from 'node:dns/promises';

// Thin injectable wrapper over Node's DNS TXT lookup, so
// CustomDomainVerificationService has a seam an e2e spec can override
// (Test.overrideProvider) — same "proxy a bare library call behind a provider"
// shape as common/nominatim.ts. No caching, no retry: the caller (verifyClaim /
// the sweep) re-checks on its own backoff schedule, and a transient DNS failure
// should read as "not there yet" at the call site, not be swallowed here.
@Injectable()
export class DnsResolver {
  // mysql2-style nested arrays: one entry per TXT record, each an array of that
  // record's string chunks (values over 255 chars are split; callers join()).
  resolveTxt(hostname: string): Promise<string[][]> {
    return resolveTxt(hostname);
  }
}
