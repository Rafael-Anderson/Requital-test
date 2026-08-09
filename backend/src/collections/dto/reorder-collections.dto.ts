import { ArrayNotEmpty, IsArray, IsInt } from 'class-validator';

// Same shape/reasoning as ReorderBioLinksDto — wrapped in an object rather
// than a bare array body, matching every other DTO's validation convention.
export class ReorderCollectionsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  ids: number[];
}
