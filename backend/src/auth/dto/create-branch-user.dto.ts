import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type { UserRole } from '../../common/tenant-context';

// Roles creatable through this endpoint — deliberately excludes nothing:
// an admin can grant any tier, including another 'admin', to a trusted
// staff member. Defaults to 'branch' (the field's original, only behavior)
// when omitted, so every existing caller of this endpoint keeps working
// unchanged.
const CREATABLE_ROLES: UserRole[] = ['admin', 'branch', 'order_manager', 'viewer'];

export class CreateBranchUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name: string;

  @IsEmail()
  @MaxLength(255)
  email: string;

  // Omitted (the default from the admin UI) means "email a real invite link
  // and let the staff member set their own password" — see
  // AuthService.createBranchUser / acceptInvite. Still accepted directly for
  // callers (existing tests, scripted setup) that want an immediately-usable
  // account without going through email.
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password?: string;

  @IsOptional()
  @IsIn(CREATABLE_ROLES)
  role?: UserRole;

  // Only 'branch' is outlet-pinned — required for that role, forbidden
  // (ignored/nulled) for every other role, same as an admin account today.
  @ValidateIf((dto: CreateBranchUserDto) => (dto.role ?? 'branch') === 'branch')
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  outletId?: number;
}
