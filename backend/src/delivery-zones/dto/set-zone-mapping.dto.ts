import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, Min } from 'class-validator';

// Saves a zone's region set AND confirms it: the merchant has reviewed what the
// zone covers. An empty list is allowed only for a zone with a placed map circle
// (checked in the service), which then matches by location alone.
export class SetZoneMappingDto {
  @IsArray()
  @ArrayMaxSize(50)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  regionIds: number[];
}
