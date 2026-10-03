// The Settings information architecture (docs/plans/product-capability-audit.md
// §14.4) as data: one place that drives the sidebar (SettingsNav), the landing
// page's grouped cards and its search. Adding a settings page means adding it
// here, or it is unreachable from navigation and search.
//
// Only pages that exist today are listed. §14.4's NEW groups (Plan & Billing,
// Notifications, Operations, Developer, Data & Privacy) are deliberately absent
// until their features land; an empty group is the dumping ground again.

export interface SettingsPage {
  href: string;
  label: string;
  description: string;
  // True for a page that lives in another top-level app (Integrations, Theme).
  external?: boolean;
}

export interface SettingsGroup {
  id: string;
  label: string;
  // The merchant question the group answers (§14.4: "group by the question").
  question: string;
  pages: SettingsPage[];
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: "business",
    label: "Business",
    question: "Who are we?",
    pages: [
      { href: "/settings/business/information", label: "Business Information", description: "Name, logo, legal details, contact and notifications" },
      { href: "/settings/business/domain", label: "Domain", description: "Your store address and custom domain" },
      { href: "/settings/business/store-configuration", label: "Store Configuration", description: "Business type, language, cart and checkout behaviour" },
      { href: "/settings/business/custom-fields", label: "Custom fields", description: "Extra fields on products and other records" },
    ],
  },
  {
    id: "selling",
    label: "Selling",
    question: "What do I charge and how do I get paid?",
    pages: [
      { href: "/settings/selling/money-tax", label: "Money & Tax", description: "Currency, tax rate, tax type and tax label" },
      { href: "/settings/business/tax-classes", label: "Tax Classes", description: "Standard, zero-rated and exempt tax treatments" },
      { href: "/integrations/payments", label: "Payments", description: "Card processor and gateway credentials", external: true },
    ],
  },
  {
    id: "fulfilment",
    label: "Fulfilment",
    question: "How do orders reach customers?",
    pages: [
      { href: "/settings/fulfilment/delivery", label: "Delivery", description: "Delivery hours, time slots, prep times and payment methods, for every outlet" },
      { href: "/settings/fulfilment/pickup", label: "Pickup", description: "Pickup hours, time slots, prep times and payment methods, for every outlet" },
      { href: "/integrations", label: "Couriers", description: "Slider and other delivery providers", external: true },
    ],
  },
  {
    id: "outlets",
    label: "Outlets",
    question: "Where do we operate?",
    pages: [
      { href: "/settings/outlets", label: "Outlets", description: "Per-outlet name, contact, address, hours, zones and QR code" },
    ],
  },
  {
    id: "storefront",
    label: "Storefront",
    question: "How does the shop look and show up?",
    pages: [
      { href: "/theme", label: "Theme", description: "Layout, colours and sections", external: true },
      { href: "/settings/storefront/display", label: "Display", description: "Product list layout, image zoom and collection menu" },
      { href: "/settings/business/online-presence", label: "Online Presence", description: "Social media links" },
      { href: "/settings/business/seo", label: "SEO", description: "Meta title, description and sharing image" },
      { href: "/settings/business/policy-pages", label: "Policy Pages", description: "Terms, privacy, refund, payment and shipping policies" },
      { href: "/settings/storefront/redirects", label: "Redirects", description: "Old URLs that forward to the right page, and a report of missing pages" },
    ],
  },
  {
    id: "team",
    label: "Team",
    question: "Who can do what?",
    pages: [
      { href: "/settings/users", label: "Users", description: "Staff accounts, invitations and branch roles" },
    ],
  },
  {
    id: "integrations",
    label: "Integrations",
    question: "What is connected?",
    pages: [
      { href: "/integrations/messaging", label: "Messaging", description: "WhatsApp number, notifications and API credentials", external: true },
      { href: "/integrations/analytics", label: "Analytics & Pixels", description: "Tracking pixels and analytics credentials", external: true },
    ],
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    question: "Is something broken?",
    pages: [
      { href: "/settings/diagnostics", label: "Diagnostics", description: "Webhook activity and failed background jobs" },
    ],
  },
];

// Individual settings, so a merchant can search for "VAT" or "prep time"
// rather than guessing which page it is on. `page` is the href of the page
// that edits it. Dead settings (documented in §14.2 as having no consumer) are
// intentionally not indexed: searching should only ever find something that
// does something.
interface SettingEntry {
  label: string;
  page: string;
  keywords?: string;
}

const SETTINGS: SettingEntry[] = [
  // Business Information
  { label: "Store published", page: "/settings/business/information", keywords: "publish live open store" },
  { label: "Logo", page: "/settings/business/information" },
  { label: "Display name", page: "/settings/business/information" },
  { label: "Business name", page: "/settings/business/information", keywords: "brand" },
  { label: "Legal business name", page: "/settings/business/information", keywords: "trademark" },
  { label: "Email", page: "/settings/business/information", keywords: "contact" },
  { label: "Description", page: "/settings/business/information" },
  { label: "Country", page: "/settings/business/information" },
  { label: "Address", page: "/settings/business/information" },
  { label: "TRN", page: "/settings/business/information", keywords: "tax registration number vat" },
  { label: "Website URL", page: "/settings/business/information" },
  { label: "Operating model", page: "/settings/business/information", keywords: "branch count" },
  { label: "Email notifications", page: "/settings/business/information", keywords: "notify" },
  { label: "Abandoned cart recovery emails", page: "/settings/business/information", keywords: "abandoned cart reminder" },
  { label: "Low-stock summary email", page: "/settings/business/information", keywords: "digest inventory" },
  { label: "Auto-deduct ingredient stock", page: "/settings/business/information", keywords: "inventory" },
  { label: "Product editor mode", page: "/settings/business/information", keywords: "simple advanced" },
  // Domain
  { label: "Custom domain", page: "/settings/business/domain", keywords: "dns verification subdomain" },
  // Store Configuration (the settings that stayed)
  { label: "Business type", page: "/settings/business/store-configuration" },
  { label: "Default language", page: "/settings/business/store-configuration", keywords: "arabic english" },
  { label: "Default delivery fee", page: "/settings/business/store-configuration", keywords: "shipping" },
  { label: "Business hours", page: "/settings/business/store-configuration", keywords: "opening" },
  { label: "External delivery", page: "/settings/business/store-configuration", keywords: "courier" },
  { label: "Disable store cart", page: "/settings/business/store-configuration", keywords: "buy now contact to order" },
  { label: "Customer survey", page: "/settings/business/store-configuration", keywords: "post-purchase feedback rating" },
  // Money & Tax
  { label: "Currency", page: "/settings/selling/money-tax", keywords: "aed sar kwd usd" },
  { label: "Tax rate", page: "/settings/selling/money-tax", keywords: "vat percent" },
  { label: "Tax type", page: "/settings/selling/money-tax", keywords: "inclusive exclusive vat" },
  { label: "Tax on delivery fee", page: "/settings/selling/money-tax", keywords: "vat shipping" },
  { label: "Tax display text", page: "/settings/selling/money-tax", keywords: "including vat label" },
  // Fulfilment
  { label: "Same-day orders", page: "/settings/fulfilment/delivery", keywords: "order dates" },
  { label: "Next-day orders", page: "/settings/fulfilment/delivery", keywords: "order dates" },
  { label: "Delivery payment methods", page: "/settings/fulfilment/delivery", keywords: "cash on delivery cod card" },
  { label: "Delivery hours", page: "/settings/fulfilment/delivery", keywords: "opening hours" },
  { label: "Delivery time slot gap", page: "/settings/fulfilment/delivery" },
  { label: "Delivery preparation time", page: "/settings/fulfilment/delivery", keywords: "prep" },
  { label: "Estimated delivery time", page: "/settings/fulfilment/delivery", keywords: "eta from to unit" },
  { label: "Same-day order cutoff", page: "/settings/fulfilment/delivery", keywords: "earliest delivery" },
  { label: "Pickup payment methods", page: "/settings/fulfilment/pickup", keywords: "cash on pickup card" },
  { label: "Pickup hours", page: "/settings/fulfilment/pickup", keywords: "opening hours" },
  { label: "Pickup time slot gap", page: "/settings/fulfilment/pickup" },
  { label: "Pickup preparation time", page: "/settings/fulfilment/pickup", keywords: "prep" },
  { label: "Delivery zones", page: "/settings/outlets", keywords: "radius fee area map" },
  { label: "Delivery available", page: "/settings/outlets", keywords: "outlet enable" },
  { label: "Pickup available", page: "/settings/outlets", keywords: "outlet enable" },
  { label: "Outlet QR code", page: "/settings/outlets" },
  // Storefront
  { label: "Product display orientation", page: "/settings/storefront/display", keywords: "grid list layout" },
  { label: "Product image zoom", page: "/settings/storefront/display" },
  { label: "Show collection menu", page: "/settings/storefront/display", keywords: "navigation categories" },
  { label: "Social links", page: "/settings/business/online-presence", keywords: "instagram tiktok facebook snapchat youtube" },
  { label: "Meta title and description", page: "/settings/business/seo", keywords: "search engine google" },
  { label: "Terms and conditions", page: "/settings/business/policy-pages", keywords: "privacy refund shipping legal" },
  { label: "URL redirects", page: "/settings/storefront/redirects", keywords: "301 302 old url migration forward seo moved" },
  { label: "404 report", page: "/settings/storefront/redirects", keywords: "missing page not found broken link" },
  // Team
  { label: "Staff accounts", page: "/settings/users", keywords: "invite user roles permissions branch role" },
  // Diagnostics
  { label: "Webhook activity", page: "/settings/diagnostics", keywords: "log delivery payment did it arrive" },
  { label: "Failed jobs", page: "/settings/diagnostics", keywords: "retry dismiss background queue" },
];

export interface SettingsHit {
  label: string;
  href: string;
  // "Fulfilment > Delivery": where it lives, shown beside the result.
  location: string;
  external: boolean;
}

interface IndexRow extends SettingsHit {
  haystack: string;
}

const pageInfo = new Map<string, { page: SettingsPage; group: SettingsGroup }>();
for (const group of SETTINGS_GROUPS) {
  for (const page of group.pages) pageInfo.set(page.href, { page, group });
}

function row(label: string, href: string, extra: string): IndexRow {
  const info = pageInfo.get(href);
  if (!info) throw new Error(`settings-registry: "${label}" points at unregistered page ${href}`);
  const location = info.group.label === info.page.label ? info.page.label : `${info.group.label} > ${info.page.label}`;
  return {
    label,
    href,
    location,
    external: !!info.page.external,
    haystack: `${label} ${extra} ${info.page.label} ${info.group.label}`.toLowerCase(),
  };
}

export const SETTINGS_INDEX: IndexRow[] = [
  ...SETTINGS_GROUPS.flatMap((g) => g.pages.map((p) => row(p.label, p.href, p.description))),
  ...SETTINGS.map((s) => row(s.label, s.page, s.keywords ?? "")),
];

// Every whitespace-separated token must appear somewhere in the row. Rows whose
// own label matches rank above rows matched only through keywords or location.
export function searchSettings(query: string, index: IndexRow[] = SETTINGS_INDEX): SettingsHit[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const scored: { hit: IndexRow; score: number }[] = [];
  for (const hit of index) {
    if (!tokens.every((t) => hit.haystack.includes(t))) continue;
    const label = hit.label.toLowerCase();
    scored.push({ hit, score: tokens.every((t) => label.includes(t)) ? 0 : 1 });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.map(({ hit: { label, href, location, external } }) => ({ label, href, location, external }));
}
