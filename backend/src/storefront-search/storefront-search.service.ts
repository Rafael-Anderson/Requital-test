import { Injectable, NotFoundException } from '@nestjs/common';
import Fuse from 'fuse.js';
import { PrismaService } from '../prisma/prisma.service';

const PAGE_SIZE = 20;
const CACHE_TTL_MS = 60_000;
// Loose enough to catch a single-character typo in a 5+ letter word (fuse.js
// score: 0 = perfect match, 1 = no match at all) — e.g. "roes" -> "rose",
// "choclate" -> "chocolate".
const FUZZY_THRESHOLD = 0.4;
// Stricter bar for the storefront's "Did you mean X?" banner specifically —
// every match under FUZZY_THRESHOLD is a usable result, but only a close
// enough one is confident enough to suggest by name.
const SUGGESTION_THRESHOLD = 0.3;

interface SearchDoc {
  id: number;
  name: string;
  slug: string;
  thumbnail: string;
  price: string;
  sku: string;
  description: string;
  tags: string;
  collections: string;
}

export interface SearchResult {
  id: number;
  name: string;
  slug: string;
  thumbnail: string;
  price: string;
}

export interface SearchResponse {
  results: SearchResult[];
  nextCursor: string | null;
  matchType: 'exact' | 'fuzzy' | 'none';
  suggestion: string | null;
}

interface ComputedResults {
  allResults: SearchResult[];
  matchType: SearchResponse['matchType'];
  suggestion: string | null;
}

interface CacheEntry {
  expiresAt: number;
  response: ComputedResults;
}

@Injectable()
export class StorefrontSearchService {
  // ponytail: a plain in-memory Map is enough for a single-instance dev/
  // small-deployment cache — no Redis assumption per the task. Ceiling: a
  // multi-instance deployment would see cache misses across instances (never
  // wrong results, just less cache benefit) and this map only ever grows
  // (no eviction beyond TTL-on-read) — revisit with an LRU cap if this ever
  // runs under real multi-instance load.
  private cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  async search(
    shopSlug: string,
    query: string,
    cursor?: string,
  ): Promise<SearchResponse> {
    const trimmed = query.trim();
    if (!trimmed) {
      return { results: [], nextCursor: null, matchType: 'none', suggestion: null };
    }

    const shop = await this.prisma.shop.findUnique({
      where: { subdomain: shopSlug },
      select: { id: true, published: true },
    });
    if (!shop || !shop.published) {
      throw new NotFoundException('Shop not found');
    }

    const cacheKey = `${shop.id}:${trimmed.toLowerCase()}`;
    let entry = this.cache.get(cacheKey);
    if (!entry || entry.expiresAt < Date.now()) {
      entry = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        response: await this.computeResults(shop.id, trimmed),
      };
      this.cache.set(cacheKey, entry);
    }

    const offset = this.decodeCursor(cursor);
    const page = entry.response.allResults.slice(offset, offset + PAGE_SIZE);
    const nextOffset = offset + PAGE_SIZE;
    const nextCursor =
      nextOffset < entry.response.allResults.length
        ? this.encodeCursor(nextOffset)
        : null;

    return {
      results: page,
      nextCursor,
      matchType: entry.response.matchType,
      suggestion: entry.response.suggestion,
    };
  }

  private encodeCursor(offset: number): string {
    return Buffer.from(String(offset), 'utf8').toString('base64');
  }

  private decodeCursor(cursor: string | undefined): number {
    if (!cursor) return 0;
    const n = Number(Buffer.from(cursor, 'base64').toString('utf8'));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  private async loadDocs(shopId: number): Promise<SearchDoc[]> {
    const products = await this.prisma.product.findMany({
      where: { shopId, status: 'Available' },
      select: {
        id: true,
        name: true,
        slug: true,
        thumbnail: true,
        price: true,
        sku: true,
        description: true,
        shortSummary: true,
        producttag: { select: { tag: { select: { name: true } } } },
        // Only MANUAL-collection membership is indexed here — a
        // RULE_BASED collection's membership is computed live (see
        // collection's own schema comment) and isn't worth re-evaluating
        // per product on every search; a shop's manually curated
        // collections (the common case) are still fully searchable.
        collectionproduct: { select: { collection: { select: { title: true } } } },
      },
    });
    return products.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      thumbnail: p.thumbnail,
      price: p.price.toString(),
      sku: p.sku,
      description: [p.shortSummary, p.description].filter(Boolean).join(' '),
      tags: p.producttag.map((t) => t.tag.name).join(' '),
      collections: p.collectionproduct.map((c) => c.collection.title).join(' '),
    }));
  }

  private async computeResults(
    shopId: number,
    query: string,
  ): Promise<ComputedResults> {
    const docs = await this.loadDocs(shopId);
    const q = query.toLowerCase();

    const exactMatches = docs.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.sku.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q) ||
        d.tags.toLowerCase().includes(q) ||
        d.collections.toLowerCase().includes(q),
    );
    if (exactMatches.length > 0) {
      return {
        allResults: exactMatches.map(toResult),
        matchType: 'exact',
        suggestion: null,
      };
    }

    const fuse = new Fuse(docs, {
      includeScore: true,
      threshold: FUZZY_THRESHOLD,
      keys: [
        { name: 'name', weight: 3 },
        { name: 'tags', weight: 2 },
        { name: 'collections', weight: 1.5 },
        { name: 'sku', weight: 1 },
        { name: 'description', weight: 1 },
      ],
    });
    const fuzzyMatches = fuse.search(query);
    if (fuzzyMatches.length === 0) {
      return { allResults: [], matchType: 'none', suggestion: null };
    }

    const best = fuzzyMatches[0];
    const suggestion =
      best.score !== undefined && best.score <= SUGGESTION_THRESHOLD
        ? best.item.name
        : null;

    return {
      allResults: fuzzyMatches.map((m) => toResult(m.item)),
      matchType: 'fuzzy',
      suggestion,
    };
  }
}

function toResult(doc: SearchDoc): SearchResult {
  return { id: doc.id, name: doc.name, slug: doc.slug, thumbnail: doc.thumbnail, price: doc.price };
}
