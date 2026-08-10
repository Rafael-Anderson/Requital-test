// mysql2 (with decimalNumbers:false) returns DECIMAL columns as JS strings
// carrying the column's full declared scale. Every money/measurement
// DECIMAL column in this schema is DECIMAL(65,30) (see prisma/migrations),
// so a value like 75 round-trips as "75.000000000000000000000000000000"
// instead of Prisma.Decimal's own trimmed "75" — trim it back here so API
// responses keep their pre-migration shape.
export function trimDecimal(value: string): string;
export function trimDecimal(value: string | null): string | null;
export function trimDecimal(value: string | null): string | null {
  if (value === null) return null;
  if (!value.includes('.')) return value;
  const trimmed = value.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' || trimmed === '-' ? '0' : trimmed;
}
