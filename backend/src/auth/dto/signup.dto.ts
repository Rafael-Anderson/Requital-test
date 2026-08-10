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
import { Transform } from 'class-transformer';
import {
  normalizePhoneToE164,
  normalizeTrn,
  normalizeWebsiteUrl,
} from '../../common/normalize';

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
  // Forgiving on input (local "0501234567", bare country-code
  // "971501234567", or full E.164 "+971501234567" are all accepted) —
  // normalized to E.164 before validation runs, so the regex below only
  // ever sees the canonical shape. Falls back to the raw value when it
  // can't be parsed at all, so a genuinely invalid phone still produces a
  // real validation error instead of silently passing/emptying.
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? (normalizePhoneToE164(value) ?? value) : value,
  )
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: 'phone must be a valid phone number',
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
  // not re-validated by format here, just bounded. Normalized to
  // digits-only storage regardless of what dashes/spacing was typed.
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? normalizeTrn(value) : value))
  @MaxLength(50)
  trn?: string;

  // Accepts a bare domain ("example.com") as well as a fully-qualified URL —
  // normalized to always carry a protocol before the regex below runs.
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? normalizeWebsiteUrl(value) : value))
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

  // Wizard-only, same optional-for-e2e-compatibility reasoning as the other
  // Location step fields above. Locked server-side once set — see
  // ShopService.update's country check — but that lock only applies to
  // later PATCH /shop calls; signup itself is always the first write.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

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
