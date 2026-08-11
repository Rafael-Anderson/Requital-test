import { Injectable, NotFoundException } from '@nestjs/common';
import Fuse from 'fuse.js';
import { DatabaseService } from '../database/database.service';
import type { RowDataPacket } from 'mysql2/promise';

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
  templates: string;
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

  constructor(private readonly db: DatabaseService) {}

  async search(
    shopSlug: string,
    query: string,
    cursor?: string,
  ): Promise<SearchResponse> {
    const trimmed = query.trim();
    if (!trimmed) {
      return {
        results: [],
        nextCursor: null,
        matchType: 'none',
        suggestion: null,
      };
    }

    const shopRows = await this.db.query<RowDataPacket[]>(
      `SELECT id, published FROM shop WHERE subdomain = ?`,
      [shopSlug],
    );
    const shop = shopRows[0];
    if (!shop || !shop.published) {
      throw new NotFoundException('Shop not found');
    }
    const shopId = shop.id as number;

    const cacheKey = `${shopId}:${trimmed.toLowerCase()}`;
    let entry = this.cache.get(cacheKey);
    if (!entry || entry.expiresAt < Date.now()) {
      entry = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        response: await this.computeResults(shopId, trimmed),
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
    // Only MANUAL-template membership is indexed here (templates joined via
    // templateproduct) — a RULE_BASED template's membership is computed
    // live (see template's own schema comment) and isn't worth
    // re-evaluating per product on every search; a shop's manually curated
    // templates (the common case) are still fully searchable. Correlated
    // subqueries (rather than a single multi-JOIN) avoid the row fan-out
    // that joining two separate one-to-many relations at once would cause.
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT p.id, p.name, p.slug, p.thumbnail, p.price, p.sku, p.description, p.shortSummary,
              (SELECT GROUP_CONCAT(t.name SEPARATOR ' ')
                 FROM producttag pt JOIN tag t ON t.id = pt.tagId
                WHERE pt.productId = p.id) AS tags,
              (SELECT GROUP_CONCAT(tpl.title SEPARATOR ' ')
                 FROM templateproduct tp JOIN template tpl ON tpl.id = tp.templateId
                WHERE tp.productId = p.id) AS templates
       FROM product p
       WHERE p.shopId = ? AND p.status = ?`,
      [shopId, 'Available'],
    );
    return rows.map((p) => ({
      id: p.id as number,
      name: p.name as string,
      slug: p.slug as string,
      thumbnail: p.thumbnail as string,
      price: p.price as string,
      sku: p.sku as string,
      description: [p.shortSummary as string | null, p.description as string | null]
        .filter(Boolean)
        .join(' '),
      tags: (p.tags as string | null) ?? '',
      templates: (p.templates as string | null) ?? '',
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
        d.templates.toLowerCase().includes(q),
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
        { name: 'templates', weight: 1.5 },
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
  return {
    id: doc.id,
    name: doc.name,
    slug: doc.slug,
    thumbnail: doc.thumbnail,
    price: doc.price,
  };
}
