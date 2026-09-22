import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ExportQueryDto {
  // Optional outlet narrowing. A branch user's own outlet always overrides
  // whatever is passed here (resolveOutletFilter), so this can only ever
  // narrow an admin's view, never widen a branch user's.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  outletId?: number;

  // Mirrors the search box on the page the export is launched from, so
  // "export" means "export what I am looking at" rather than silently ignoring
  // an active filter. Only honoured by definitions that document it.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
