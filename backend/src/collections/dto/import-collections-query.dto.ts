import { IsIn, IsOptional } from 'class-validator';

// Query for POST /collections/import/preview and /confirm.
export class ImportCollectionsQueryDto {
  // What to do with a collection that already exists. Default: skip.
  @IsOptional()
  @IsIn(['update', 'skip'])
  onExisting?: 'update' | 'skip';
}
