import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const DOMAIN_TYPES = ['subdomain', 'custom'] as const;
export type DomainType = (typeof DOMAIN_TYPES)[number];

// customDomain's own format/presence rules (required for 'custom', must be
// absent for 'subdomain') are enforced in ShopService.updateDomain, not here
// — same discriminated-fields-checked-in-the-service pattern bio-links.service.ts's
// assertFieldsMatchType uses, since class-validator has no clean built-in for
// "required only when a sibling field equals X" beyond @ValidateIf, and this
// needs a real error message per case anyway.
export class UpdateShopDomainDto {
  @IsIn(DOMAIN_TYPES)
  type: DomainType;

  @IsOptional()
  @IsString()
  @MaxLength(253)
  customDomain?: string;
}
