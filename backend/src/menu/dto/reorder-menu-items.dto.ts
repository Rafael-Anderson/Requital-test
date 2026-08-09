import { ArrayNotEmpty, IsArray, IsInt } from 'class-validator';

// Same shape/reasoning as ReorderBioLinksDto/ReorderCollectionsDto.
export class ReorderMenuItemsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  ids: number[];
}
