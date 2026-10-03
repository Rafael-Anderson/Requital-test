import { IsBoolean } from 'class-validator';

export class SetReviewFeaturedDto {
  @IsBoolean()
  featured: boolean;
}
