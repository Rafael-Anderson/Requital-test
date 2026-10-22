import { IsIn, IsString, MaxLength } from 'class-validator';
import { MAPS_ERROR_CODES } from '../maps-error-codes';

// Unauthenticated and spoofable: the code must be one of the four known ones
// and the host is checked against the shop's own hosts before anything is stored.
export class ReportMapsErrorDto {
  @IsIn([...MAPS_ERROR_CODES])
  code: string;

  @IsString()
  @MaxLength(255)
  host: string;
}
