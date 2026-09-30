import { BadRequestException, Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { RegionRow } from '../db/types';
import { REGION_LABELS } from './regions.constants';

export interface RegionSummary {
  id: number;
  code: string;
  nameEn: string;
  nameAr: string;
}

// What an address write carries.
export interface RegionInput {
  regionId?: number | null;
}

// What a resolved address write persists (`regionId`) plus the region's English
// name, which is NOT stored: the legacy zone matcher compares it with a zone name.
export interface ResolvedRegion {
  regionId: number | null;
  regionName: string | null;
}

@Injectable()
export class RegionsService {
  constructor(private readonly db: DatabaseService) {}

  // The regions a shop's address forms should offer: those of the shop's own
  // country. A shop with no country code gets none; its country is unknown, so
  // nothing is guessed.
  async listForShop(shopId: number) {
    const countryCode = await this.shopCountryCode(shopId);
    if (!countryCode) return { country: null, regions: [] };
    const regions = await this.db.query<(RegionRow & RowDataPacket)[]>(
      `SELECT id, code, nameEn, nameAr, sortOrder
         FROM region WHERE countryCode = ? ORDER BY sortOrder, id`,
      [countryCode],
    );
    return {
      country: {
        code: countryCode,
        regionLabel: REGION_LABELS[countryCode] ?? 'Region',
      },
      regions,
    };
  }

  // THE region check. Every write path that stores a region goes through here
  // (tools/check-region-validation.js enforces that), because the thing being
  // validated is a function of the TENANT: a region is valid for a shop only if
  // it belongs to the shop's own country. `required` is per path, mirroring what
  // each old per-DTO emirate validator demanded.
  async resolveForShop(
    shopId: number,
    input: RegionInput,
    opts: { required: boolean },
  ): Promise<ResolvedRegion> {
    const countryCode = await this.shopCountryCode(shopId);

    if (input.regionId == null) {
      // "Required" only binds where there is something to choose from. A shop
      // whose country is unknown, or has no region model ("Other"), offers no
      // regions, so demanding one would make checkout impossible for it.
      if (opts.required && countryCode) {
        throw new BadRequestException('regionId is required');
      }
      return { regionId: null, regionName: null };
    }
    if (!countryCode) {
      throw new BadRequestException(
        "Set your shop's country before choosing a region",
      );
    }
    const region = await this.findById(input.regionId);
    if (!region || region.countryCode !== countryCode) {
      // One message for "no such region" and "another country's region", so a
      // probe cannot enumerate which ids exist.
      throw new BadRequestException(
        "regionId is not a region of this shop's country",
      );
    }
    return { regionId: region.id, regionName: region.nameEn };
  }

  // The many-regions sibling of resolveForShop, for a delivery zone's region set:
  // every id must be a region of the shop's own country. Returns the de-duplicated
  // ids. An empty list is valid (a zone covered by a map circle alone).
  async resolveManyForShop(
    shopId: number,
    regionIds: number[],
  ): Promise<number[]> {
    const unique = [...new Set(regionIds)];
    if (unique.length === 0) return [];
    const countryCode = await this.shopCountryCode(shopId);
    if (!countryCode) {
      throw new BadRequestException(
        "Set your shop's country before choosing regions",
      );
    }
    const found = await this.db.query<({ id: number } & RowDataPacket)[]>(
      `SELECT id FROM region WHERE countryCode = ? AND id IN (${unique
        .map(() => '?')
        .join(', ')})`,
      [countryCode, ...unique],
    );
    if (found.length !== unique.length) {
      throw new BadRequestException(
        "regionIds must all be regions of this shop's country",
      );
    }
    return unique;
  }

  private async shopCountryCode(shopId: number): Promise<string | null> {
    const rows = await this.db.query<
      ({ countryCode: string | null } & RowDataPacket)[]
    >(`SELECT countryCode FROM shop WHERE id = ?`, [shopId]);
    return rows[0]?.countryCode ?? null;
  }

  private async findById(id: number): Promise<RegionRow | undefined> {
    const rows = await this.db.query<(RegionRow & RowDataPacket)[]>(
      `SELECT * FROM region WHERE id = ?`,
      [id],
    );
    return rows[0];
  }
}

// Adds `region: { id, code, nameEn, nameAr } | null` to each row that carries a
// `regionId`, in one query. A plain function taking the db handle so the read
// paths (orders, drafts, outlets, tracking) need no module dependency.
export async function attachRegion<T extends { regionId?: number | null }>(
  db: DatabaseService,
  rows: T[],
): Promise<(T & { region: RegionSummary | null })[]> {
  const ids = [
    ...new Set(
      rows.map((r) => r.regionId).filter((v): v is number => v != null),
    ),
  ];
  const byId = new Map<number, RegionSummary>();
  if (ids.length > 0) {
    const found = await db.query<(RegionSummary & RowDataPacket)[]>(
      `SELECT id, code, nameEn, nameAr FROM region WHERE id IN (${ids
        .map(() => '?')
        .join(', ')})`,
      ids,
    );
    for (const r of found) byId.set(r.id, r);
  }
  return rows.map((r) => ({
    ...r,
    region: r.regionId != null ? (byId.get(r.regionId) ?? null) : null,
  }));
}
