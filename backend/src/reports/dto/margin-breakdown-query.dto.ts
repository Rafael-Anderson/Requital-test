import { IsIn, IsOptional } from 'class-validator';
import { ReportsFilterQueryDto } from './reports-filter-query.dto';
import type { MarginDimension } from '../reports.service';

export const MARGIN_DIMENSION_KEYS = [
  'product',
  'collection',
  'channel',
  'outlet',
  'order',
] as const;

// Extends the shared reports filter rather than redeclaring date/outlet/
// orderType. `dimension` is validated against a closed set because it selects
// a fixed SQL fragment in MARGIN_DIMENSIONS - nothing from the query string
// ever reaches the statement.
export class MarginBreakdownQueryDto extends ReportsFilterQueryDto {
  @IsOptional()
  @IsIn(MARGIN_DIMENSION_KEYS)
  dimension?: MarginDimension = 'product';
}
