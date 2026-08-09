import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MENU_ITEM_TYPES, type MenuItemType } from '../menu-constants';

export class MenuItemCollectionInput {
  @IsInt()
  @IsPositive()
  collectionId: number;

  @IsInt()
  @Min(0)
  sortOrder: number;
}

// LINK requires collectionId and forbids collections; DROPDOWN requires
// collections (>=1) and forbids collectionId — enforced in MenuService since
// it depends on the sibling `type` field, same discriminated-fields pattern
// bio-links uses for its own (larger) type union.
export class CreateMenuItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label: string;

  @IsIn(MENU_ITEM_TYPES)
  type: MenuItemType;

  // LINK only.
  @IsOptional()
  @IsInt()
  @IsPositive()
  collectionId?: number;

  // DROPDOWN only. Full replace of membership+order on every save, same
  // convention as SetTemplateCollectionsDto.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MenuItemCollectionInput)
  collections?: MenuItemCollectionInput[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
