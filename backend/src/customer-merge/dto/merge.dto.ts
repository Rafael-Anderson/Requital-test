import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
} from 'class-validator';

export class MergeCustomersDto {
  // The customers to fold INTO the one in the URL. Same shop, never the primary.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsInt({ each: true })
  duplicateIds!: number[];

  // The merge cannot be undone. The admin types the word in the UI; the server
  // insists on it too, so a script or a stray call cannot merge by accident.
  @IsIn(['MERGE'])
  confirm!: 'MERGE';
}

export class PreviewMergeDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsInt({ each: true })
  duplicateIds!: number[];
}
