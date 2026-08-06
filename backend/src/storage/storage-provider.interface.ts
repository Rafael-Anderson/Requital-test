// Strategy interface, mirrors email/email-provider.interface.ts's
// EmailProvider shape (one active implementation resolved at boot, not a
// per-shop registry like PaymentProvider — storage backend is a
// platform-level deployment choice, not something a merchant configures).
export interface SaveFileInput {
  // Storage-relative path, e.g. "products/42/3f2c…_thumb.jpg" — never
  // trusted from client input; always server-constructed (see
  // storage.service.ts). Local provider joins this under UPLOAD_ROOT;
  // S3 provider uses it as the object key verbatim.
  key: string;
  buffer: Buffer;
  contentType: string;
}

export interface SavedFile {
  key: string;
  // Publicly resolvable URL — /uploads/<key> for the local provider,
  // <endpoint>/<bucket>/<key> (path-style) for the S3 provider.
  url: string;
}

export interface StorageProvider {
  readonly name: string;
  save(input: SaveFileInput): Promise<SavedFile>;
  // No-op (not an error) if the key doesn't exist — mirrors Node's fs.rm
  // { force: true } semantics rather than throwing on "already gone",
  // since delete is often called for a variant that may not have been
  // written (see StorageService.deleteImage deriving _thumb/_medium keys
  // from a base key without checking each one exists first).
  delete(key: string): Promise<void>;
}
