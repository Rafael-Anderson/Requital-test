import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsPositive,
  Min,
  ValidateNested,
} from 'class-validator';

class TemplateCollectionInput {
  @IsInt()
  @IsPositive()
  collectionId: number;

  @IsInt()
  @Min(0)
  sortOrder: number;
}

// Full replace, same convention as SetTemplateProductsDto — the caller sends
// the complete desired membership+order every time. COLLECTION_GROUP
// templates only (see TemplatesService.setCollections).
export class SetTemplateCollectionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateCollectionInput)
  collections: TemplateCollectionInput[];
}
