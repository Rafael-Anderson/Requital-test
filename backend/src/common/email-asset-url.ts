// An image that is going into an EMAIL must be an absolute https URL: a relative
// "/uploads/x.png" resolves against nothing in a mail client, and most clients
// block plain http images. Uploaded files are stored as "/uploads/<key>" and are
// served by the API host, which is "api.<root domain>" (the same root domain
// the storefront subdomains hang off). Anything else (a data: URI, an http URL,
// garbage) yields null and the email simply omits the picture.
const ROOT_DOMAIN = (): string =>
  process.env.STOREFRONT_ROOT_DOMAIN ?? 'requital.io';

export function emailAssetUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const v = url.trim();
  if (/^https:\/\/[^\s"'<>]+$/i.test(v)) return v;
  if (/^\/uploads\/[^\s"'<>]+$/.test(v)) {
    return `https://api.${ROOT_DOMAIN()}${v}`;
  }
  return null;
}
