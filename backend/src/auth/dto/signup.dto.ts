import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export const BUSINESS_TYPES = ['Retail', 'F&B', 'Services', 'Other'] as const;
export const OPERATING_MODELS = [
  'online_only',
  'in_person_only',
  'both',
] as const;
export const BRANCH_COUNTS = ['1', '2-5', '6-10', '10+'] as const;

export class SignupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name: string;

  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt silently truncates beyond 72 bytes
  password: string;

  // Account Setup wizard's Personal Info step — see admin/lib/validators.ts
  // for the matching frontend regex, kept in sync by hand. Optional here
  // (not @IsNotEmpty) even though the wizard requires it before ever
  // submitting: 40+ e2e specs call this endpoint directly with the pre-wizard
  // minimal payload, and this DTO has no way to tell "the wizard" apart from
  // any other caller.
  @IsOptional()
  @IsString()
  @Matches(/^(\+)?[0-9]{7,15}$/, {
    message: 'phone must be 7-15 digits, with an optional leading +',
  })
  phone?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  shopName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(63)
  @Matches(/^[a-z0-9-]+$/, {
    message:
      'subdomain may only contain lowercase letters, numbers, and hyphens',
  })
  subdomain: string;

  @IsOptional()
  @IsIn(BUSINESS_TYPES)
  businessType?: string;

  // Lenient by design (see admin/lib/validators.ts's TRN regex comment) —
  // not re-validated by format here, just bounded.
  @IsOptional()
  @IsString()
  @MaxLength(50)
  trn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^https?:\/\//i, {
    message: 'websiteUrl must start with http:// or https://',
  })
  websiteUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  address?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(OPERATING_MODELS, { each: true })
  operatingModel?: string[];

  @IsOptional()
  @IsIn(BRANCH_COUNTS)
  branchCount?: string;

  // Account Setup wizard's Review & Confirm step — see shop.productEditorMode.
  // Optional for the same reason as the other wizard-only fields above:
  // e2e specs call this endpoint with the pre-wizard minimal payload.
  @IsOptional()
  @IsIn(['simple', 'advanced'])
  productEditorMode?: string;
}
