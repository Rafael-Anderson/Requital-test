import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListShopsQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(['active', 'suspended'])
  status?: 'active' | 'suspended';
}
