import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
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
import {
  MENU_COLUMN_LINK_TYPES,
  MENU_ITEM_TYPES,
  type MenuColumnLinkType,
  type MenuItemType,
} from '../menu-constants';

export class MenuItemCollectionInput {
  @IsInt()
  @IsPositive()
  collectionId: number;

  @IsInt()
  @Min(0)
  sortOrder: number;
}

// One link inside a MEGA menu item's column — exactly one of
// collectionId/productId/customUrl is set, matching linkType (validated in
// MenuService.assertColumnLinksMatchType, same discriminated-fields
// approach CreateMenuItemDto itself already uses for LINK/DROPDOWN/MEGA).
export class MenuColumnLinkInput {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label: string;

  @IsIn(MENU_COLUMN_LINK_TYPES)
  linkType: MenuColumnLinkType;

  @IsOptional()
  @IsInt()
  @IsPositive()
  collectionId?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  productId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  customUrl?: string;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @IsInt()
  @Min(0)
  sortOrder: number;
}

export class MenuItemStyleInput {
  @IsOptional()
  @IsString()
  textColor?: string;

  @IsOptional()
  @IsString()
  backgroundColor?: string;

  @IsOptional()
  @IsIn(['none', 'slight', 'pill'])
  borderRadius?: 'none' | 'slight' | 'pill';

  @IsOptional()
  @IsIn(['normal', 'medium', 'bold'])
  fontWeight?: 'normal' | 'medium' | 'bold';

  @IsOptional()
  @IsString()
  hoverBackgroundColor?: string;
}

export class MenuColumnInput {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title: string;

  @IsInt()
  @Min(0)
  sortOrder: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MenuColumnLinkInput)
  links: MenuColumnLinkInput[];
}

// LINK requires collectionId and forbids collections/columns; DROPDOWN
// requires collections (>=1) and forbids collectionId/columns; MEGA
// requires columns (>=1, each with >=1 link) and forbids collectionId/
// collections — enforced in MenuService since it depends on the sibling
// `type` field, same discriminated-fields pattern bio-links uses for its
// own (larger) type union.
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

  // MEGA only. Full replace of columns+links on every save, same convention
  // as `collections` above.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MenuColumnInput)
  columns?: MenuColumnInput[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;

  // Applies to every type (LINK/DROPDOWN/MEGA) — it styles the top-level
  // nav trigger itself, not the flyout content.
  @IsOptional()
  @ValidateNested()
  @Type(() => MenuItemStyleInput)
  style?: MenuItemStyleInput;
}
