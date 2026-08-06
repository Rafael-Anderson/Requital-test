// The stored filename is always server-generated (UUID + sniffed
// extension — see StorageService), so the client's original filename never
// actually lands in a path anywhere; path traversal via filename is
// structurally impossible regardless of this check. This is still a real,
// explicit rejection at the request boundary rather than a silent no-op:
// a filename carrying `../`, a null byte, or a raw path separator is
// itself suspicious client behavior worth rejecting outright, not proof of
// exploitability the current design happens to avoid.
//
// In practice, a raw directory-separator-based traversal (e.g.
// "../../etc/passwd.png") never reaches this function with the separators
// intact — busboy (multer's underlying multipart parser) already applies
// path.basename() to the client's declared filename unless `preservePath`
// is set (it isn't, see common/image-upload.config.ts), reducing it to
// "passwd.png" before Nest even sees it. The `/`/`\\` checks below are
// still real defense-in-depth for any future caller of this function that
// doesn't go through multer (or a multer config that does set
// preservePath); the `..`-with-no-separator and null-byte checks are what
// actually fire against a real multipart upload today — confirmed via
// test/storage.e2e-spec.ts, not assumed.
export function isFilenameSafe(name: string): boolean {
  if (!name) return false;
  if (name.includes('\0')) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name.includes('..')) return false;
  return true;
}

// Whitelist-based sanitizer, used only for the extension-check hint the
// error message shows back to the caller — strips any path component, null
// bytes, and any character outside [a-zA-Z0-9._-].
export function sanitizeFilename(name: string): string {
  const base = name.replace(/\0/g, '').split(/[/\\]/).pop() ?? '';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}
