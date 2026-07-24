// Domain fragments each platform's URL is expected to contain at least one
// of — a loose sanity check, not a strict allowlist (subdomains and regional
// TLDs still pass; this only catches "pasted the wrong platform's link").
export const SOCIAL_PLATFORM_DOMAINS: Record<string, string[]> = {
  instagram: ['instagram.com'],
  facebook: ['facebook.com', 'fb.com'],
  tiktok: ['tiktok.com'],
  telegram: ['t.me', 'telegram.me', 'telegram.org'],
  snapchat: ['snapchat.com'],
  x: ['x.com', 'twitter.com'],
  threads: ['threads.net', 'threads.com'],
  youtube: ['youtube.com', 'youtu.be'],
};

export const SOCIAL_PLATFORMS = Object.keys(SOCIAL_PLATFORM_DOMAINS);
