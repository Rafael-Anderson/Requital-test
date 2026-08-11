interface MysqlError extends Error {
  errno: number;
}

const isMysqlError = (e: unknown): e is MysqlError =>
  e instanceof Error && typeof (e as MysqlError).errno === 'number';

// Replaces Prisma's P2002 (unique constraint violation).
export const isDuplicateKeyError = (e: unknown) =>
  isMysqlError(e) && e.errno === 1062;

// Replaces Prisma's P2034 (write conflict / deadlock).
export const isLockConflict = (e: unknown) =>
  isMysqlError(e) && (e.errno === 1213 || e.errno === 1205);
