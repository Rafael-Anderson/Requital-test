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
  // Added for Bio Links' SOCIAL_ICON platform set (see
  // bio-link-constants.ts) — pinterest wasn't previously a settable Online
  // Presence platform at all, so this is what gives a Bio Links "Pinterest"
  // icon a real URL to resolve from (shop.socialLinks.pinterest) rather than
  // never being satisfiable. No dedicated Online Presence UI tile was added
  // for it (out of scope here) — settable today via PATCH /shop
  // {socialLinks:{pinterest:"..."}}, same as every other key in this map.
  pinterest: ['pinterest.com', 'pin.it'],
};

export const SOCIAL_PLATFORMS = Object.keys(SOCIAL_PLATFORM_DOMAINS);
