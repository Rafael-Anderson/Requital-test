import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ALL_PERMISSIONS, type Permission } from '../../common/permissions';

export class UpdateBranchRoleDto {
  @IsOptional()
  @IsString()
  @MaxLength(191)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(ALL_PERMISSIONS, { each: true })
  permissions?: Permission[];
}
