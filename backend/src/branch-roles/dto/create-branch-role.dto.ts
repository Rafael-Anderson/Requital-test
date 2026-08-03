import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { ALL_PERMISSIONS, type Permission } from '../../common/permissions';

export class CreateBranchRoleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name: string;

  // Validated against the fixed vocabulary, not accepted as free-form
  // strings — a typo'd or invented permission would otherwise silently
  // never match anything any call site checks for, which reads as "works"
  // but grants nothing.
  @IsArray()
  @ArrayUnique()
  @IsIn(ALL_PERMISSIONS, { each: true })
  permissions: Permission[];
}
