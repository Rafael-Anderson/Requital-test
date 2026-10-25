// Pure validators for a shop's sending domain. Framework-free so the spec can
// drive them directly. Stricter than the custom-domain validator: a sending
// domain must be a registrable domain the merchant owns, not a mailbox
// provider's, not a public suffix, and not ours.

const HOSTNAME_REGEX =
  /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,63}$/;

const PLATFORM_ROOT_DOMAIN = 'requital.io';

// Mailbox providers: a merchant cannot prove control of these, and mail
// "from" them would be spoofing. Exact domain or any subdomain.
const FREE_MAIL_DOMAINS = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'zoho.com',
  'yandex.com',
  'yandex.ru',
  'mail.ru',
  'qq.com',
  '163.com',
  '126.com',
  'naver.com',
  'fastmail.com',
  'tutanota.com',
  'hey.com',
  'inbox.com',
  'rediffmail.com',
];

// Multi-label public suffixes (eTLDs) that appear as a bare "domain" input.
// ponytail: static list for the Gulf plus the common ones, no `psl` dependency;
// add a suffix here if a merchant is wrongly accepted (the provider would
// reject a true public suffix at create time anyway).
const PUBLIC_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'me.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'co.za',
  'co.in',
  'net.in',
  'org.in',
  'com.br',
  'com.mx',
  'com.tr',
  'com.eg',
  'com.sa',
  'net.sa',
  'org.sa',
  'gov.sa',
  'edu.sa',
  'med.sa',
  'co.ae',
  'net.ae',
  'org.ae',
  'gov.ae',
  'ac.ae',
  'sch.ae',
  'com.kw',
  'edu.kw',
  'gov.kw',
  'com.qa',
  'edu.qa',
  'gov.qa',
  'com.bh',
  'edu.bh',
  'gov.bh',
  'com.om',
  'edu.om',
  'gov.om',
  'co.jp',
  'co.kr',
  'com.cn',
  'com.sg',
  'com.hk',
  'com.pk',
  'com.ng',
  'co.ke',
]);

export function normalizeSendingDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/\.$/, '');
}

function isOrUnder(host: string, base: string): boolean {
  return host === base || host.endsWith(`.${base}`);
}

// Returns null when acceptable, otherwise a merchant-facing reason.
export function sendingDomainProblem(domain: string): string | null {
  if (!domain || domain.length > 253 || !HOSTNAME_REGEX.test(domain)) {
    return 'Enter a valid domain such as mail.yourshop.com.';
  }
  if (isOrUnder(domain, PLATFORM_ROOT_DOMAIN)) {
    return 'That domain belongs to Requital. Use a domain you own.';
  }
  if (FREE_MAIL_DOMAINS.some((d) => isOrUnder(domain, d))) {
    return 'Free mailbox domains cannot be used. Use a domain you own.';
  }
  if (PUBLIC_SUFFIXES.has(domain)) {
    return 'That is a public suffix, not a domain you own.';
  }
  return null;
}

// A shop display name becomes the From display name. Strip everything that can
// break out of the quoted string or inject a header: CR/LF and other control
// characters, double quotes, backslashes, angle brackets. Never empty.
export function sanitizeDisplayName(name: string | undefined | null): string {
  const cleaned = (name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u2028\u2029"\\<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 78)
    .trim();
  return cleaned || 'Requital';
}
