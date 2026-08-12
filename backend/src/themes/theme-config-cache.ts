import { Injectable } from '@nestjs/common';
import type { ThemeConfig } from './theme-config.types';

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  expiresAt: number;
  config: ThemeConfig | null;
}

// Direct copy of StorefrontSearchService's own in-memory Map+TTL cache
// pattern (backend/src/storefront-search/storefront-search.service.ts) — the
// only cache precedent in this backend.
//
// ponytail: a plain in-memory Map is enough for a single-instance
// deployment — no Redis assumption. Ceiling: a multi-instance deployment
// would see cache misses across instances (never wrong results, just less
// cache benefit), and this map only ever grows (no eviction beyond
// TTL-on-read) — revisit with an LRU cap if this ever runs under real
// multi-instance load.
@Injectable()
export class ThemeConfigCache {
  private cache = new Map<number, CacheEntry>();

  get(shopId: number): { hit: true; config: ThemeConfig | null } | { hit: false } {
    const entry = this.cache.get(shopId);
    if (!entry || entry.expiresAt < Date.now()) return { hit: false };
    return { hit: true, config: entry.config };
  }

  set(shopId: number, config: ThemeConfig | null) {
    this.cache.set(shopId, { expiresAt: Date.now() + CACHE_TTL_MS, config });
  }

  // Called from ThemesService.publish()/.remove() so a publish is
  // near-instant rather than waiting out the 60s TTL.
  invalidate(shopId: number) {
    this.cache.delete(shopId);
  }
}
