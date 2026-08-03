import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class CreateAffiliateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  // Same shape as CustomersService's phone validation — kept in sync by hand.
  @Matches(/^\+?[0-9][0-9\s-]{5,19}$/, {
    message:
      'mobile must contain only digits, spaces, hyphens, and an optional leading +',
  })
  mobile: string;
}
