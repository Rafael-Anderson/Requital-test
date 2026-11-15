import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// The ONE backend pagination helper. A list endpoint that can grow without bound
// takes `page` and `pageSize`, runs one COUNT and one bounded SELECT, and answers
// with the same envelope every merchant-side list already uses:
// `{ data, page, pageSize, total }`.
//
// - pageSize is capped at PAGE_SIZE_MAX by validation (a 101 is a 400, never a
//   silent clamp), and resolvePage() clamps again so a caller that bypasses the
//   DTO still cannot ask for everything in one query.
// - Ordering is the caller's job and MUST be total: end the ORDER BY with a
//   unique column (the id), or two rows with an equal sort value can swap between
//   one page and the next and a row is shown twice or never.
// - Shop scoping is the caller's job too: the WHERE of both the COUNT and the
//   SELECT carries the shopId, so `total` can never count another shop's rows.
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGE_SIZE_MAX)
  pageSize?: number;
}

export interface Page<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

// True when the caller asked for a page. Endpoints that predate pagination keep
// returning their whole list when neither parameter is present, so every
// existing consumer (pickers, exports) is unchanged.
export function isPaginated(q: { page?: number; pageSize?: number }): boolean {
  return q.page !== undefined || q.pageSize !== undefined;
}

export function resolvePage(
  q: { page?: number; pageSize?: number },
  defaults: { pageSize?: number } = {},
): { page: number; pageSize: number; limit: number; offset: number } {
  const page = Math.max(1, Math.trunc(q.page ?? 1));
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Math.trunc(q.pageSize ?? defaults.pageSize ?? PAGE_SIZE_DEFAULT)),
  );
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

export function toPage<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number,
): Page<T> {
  return { data, page, pageSize, total };
}

// A LIKE pattern that matches `value` literally anywhere in the column: the
// wildcards the user typed (% _ \) are escaped. Use with ESCAPE '\\'.
export function likeContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
