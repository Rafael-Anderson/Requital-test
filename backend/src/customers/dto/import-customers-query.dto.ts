import { IsIn, IsOptional } from 'class-validator';

// Query for POST /customers/import/preview and /confirm.
export class ImportCustomersQueryDto {
  // A phone number that already belongs to a customer: `skip` (default) leaves
  // that customer untouched; `update` only fills an empty email and adds an
  // address they do not have. It never overwrites a name or an email.
  @IsOptional()
  @IsIn(['update', 'skip'])
  onExisting?: 'update' | 'skip';
}
