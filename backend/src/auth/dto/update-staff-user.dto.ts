import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { UserRole } from '../../common/tenant-context';

const UPDATABLE_ROLES: UserRole[] = [
  'admin',
  'branch',
  'order_manager',
  'viewer',
];

export class UpdateStaffUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  name?: string;

  @IsOptional()
  @IsIn(UPDATABLE_ROLES)
  role?: UserRole;

  // Only meaningful when the resulting role (this field, or the user's
  // existing role if this request doesn't change it) is 'branch' — see
  // AuthService.updateStaffUser. Required in that case, ignored/cleared
  // otherwise, same as create.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  outletId?: number;
}
