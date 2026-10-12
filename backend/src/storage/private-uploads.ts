import { posix } from 'path';
import type { NextFunction, Request, Response } from 'express';

// Keys under these prefixes are PRIVATE: they are read back only through an
// authenticated, tenant-scoped endpoint (StorageService.readProof), never from
// the public /uploads static route. Files written before this existed sit in
// the same directory, so the prefix is refused here rather than moved.
export const PRIVATE_UPLOAD_PREFIXES = ['delivery-proof/'];

export function isPrivateUploadPath(rawPath: string): boolean {
  let decoded: string;
  try {
    // Express's static handler decodes percent-escapes, so this must too.
    decoded = decodeURIComponent(rawPath);
  } catch {
    return true; // malformed escape: refuse rather than guess
  }
  const clean = posix
    .normalize(decoded.replace(/\\/g, '/'))
    .replace(/^\/+/, '')
    .toLowerCase();
  return PRIVATE_UPLOAD_PREFIXES.some((p) => clean.startsWith(p));
}

// Mount at '/uploads' BEFORE the static handler.
export function blockPrivateUploads(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isPrivateUploadPath(req.path)) {
    res.status(404).end();
    return;
  }
  next();
}
