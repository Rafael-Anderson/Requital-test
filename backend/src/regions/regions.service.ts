import { BadRequestException, Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { RegionRow } from '../db/types';
import { LEGACY_ALIAS_COUNTRY, REGION_LABELS } from './regions.constants';

export interface RegionSummary {
  id: number;
  code: string;
  nameEn: string;
  nameAr: string;
}

// What an address write carries. `emirate` is the DEPRECATED name-based alias,
// accepted only while older frontends are still deployed; `regionId` is the
// real field.
export interface RegionInput {
  regionId?: number | null;
  emirate?: string | null;
}

// The pair an address write persists. `emirate` mirrors the region's English
// name so every reader that has not moved to `regionId` keeps working until the
// column is dropped.
export interface ResolvedRegion {
  regionId: number | null;
  emirate: string | null;
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
  // each old `@IsIn(EMIRATES)` DTO demanded.
  async resolveForShop(
    shopId: number,
    input: RegionInput,
    opts: { required: boolean },
  ): Promise<ResolvedRegion> {
    const hasId = input.regionId != null;
    const alias = input.emirate?.trim();
    const hasAlias = !!alias;

    if (!hasId && !hasAlias) {
      if (opts.required) {
        throw new BadRequestException('regionId is required');
      }
      return { regionId: null, emirate: null };
    }
    const countryCode = await this.shopCountryCode(shopId);

    let byId: RegionRow | undefined;
    if (hasId) {
      if (!countryCode) {
        throw new BadRequestException(
          "Set your shop's country before choosing a region",
        );
      }
      byId = await this.findById(input.regionId as number);
      if (!byId || byId.countryCode !== countryCode) {
        // One message for "no such region" and "another country's region", so a
        // probe cannot enumerate which ids exist.
        throw new BadRequestException(
          "regionId is not a region of this shop's country",
        );
      }
    }

    let byAlias: RegionRow | undefined;
    if (hasAlias) {
      byAlias = await this.findByName(
        countryCode ?? LEGACY_ALIAS_COUNTRY,
        alias,
      );
      if (!byAlias) {
        throw new BadRequestException(
          `emirate is not a region of this shop's country: ${alias}`,
        );
      }
    }

    if (byId && byAlias && byId.id !== byAlias.id) {
      throw new BadRequestException(
        'regionId and emirate name different regions',
      );
    }

    const region = (byId ?? byAlias) as RegionRow;
    return {
      // A shop with no country code validated the alias as UAE, but it is not
      // recorded as a UAE region: its country is unknown.
      regionId: countryCode ? region.id : null,
      emirate: region.nameEn,
    };
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

  private async findByName(
    countryCode: string,
    name: string,
  ): Promise<RegionRow | undefined> {
    const rows = await this.db.query<(RegionRow & RowDataPacket)[]>(
      `SELECT * FROM region WHERE countryCode = ? AND nameEn = ?`,
      [countryCode, name],
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
