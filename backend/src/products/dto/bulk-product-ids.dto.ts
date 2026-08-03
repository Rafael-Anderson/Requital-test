import {
  ArrayNotEmpty,
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsPositive,
} from 'class-validator';

export class BulkProductIdsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  productIds: number[];
}
