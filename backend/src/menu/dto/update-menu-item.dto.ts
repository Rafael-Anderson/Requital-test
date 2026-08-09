import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MENU_ITEM_TYPES, type MenuItemType } from '../menu-constants';
import { MenuItemCollectionInput } from './create-menu-item.dto';

export class UpdateMenuItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsIn(MENU_ITEM_TYPES)
  type?: MenuItemType;

  @IsOptional()
  @IsInt()
  @IsPositive()
  collectionId?: number;

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
