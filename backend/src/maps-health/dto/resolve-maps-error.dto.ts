import { IsIn, IsString, MaxLength } from 'class-validator';
import { MAPS_ERROR_CODES } from '../maps-error-codes';

export class ResolveMapsErrorDto {
  @IsIn([...MAPS_ERROR_CODES])
  code: string;

  @IsString()
  @MaxLength(255)
  host: string;
}
