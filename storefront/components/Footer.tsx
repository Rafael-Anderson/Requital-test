import Link from "next/link";
import { CreditCard, Banknote, Mail, Phone } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { resolveImageUrl } from "@/lib/api";
import { SOCIAL_ICONS } from "@/lib/social-icons";
import { POLICY_PAGE_LABELS, POLICY_PAGE_TYPES, type Density, type Shop } from "@/lib/types";

// URL segment -> PolicyPageType — lowercase/hyphenated in the URL, the
// backend's uppercase enum value everywhere else (DB, API). See
// app/[shop]/policies/[type]/page.tsx.
const POLICY_URL_SLUGS: Record<(typeof POLICY_PAGE_TYPES)[number], string> = {
  TERMS: "terms",
  PRIVACY: "privacy",
  REFUND: "refund",
  PAYMENT: "payment",
  SHIPPING: "shipping",
};

// Height/padding only — independent of footerLayout's arrangement below, so
// any arrangement can pair with any density (see schema.prisma's comment on
// themesettings.footerDensity).
const FOOTER_DENSITY_PADDING: Record<Density, { main: string; bottom: string }> = {
  compact: { main: "py-6", bottom: "py-2.5" },
  regular: { main: "py-12", bottom: "py-4" },
  spacious: { main: "py-20", bottom: "py-6" },
};

function paymentBadges(shop: Shop): { key: string; label: string; Icon: typeof CreditCard }[] {
  const badges: { key: string; label: string; Icon: typeof CreditCard }[] = [];
  // Real config, not a fixed icon set that might not match what this shop
  // actually accepts — see the task's own instruction.
  if (shop.cardProcessorEnabled) badges.push({ key: "card", label: "Card", Icon: CreditCard });
  if (shop.deliveryPaymentCashOnDelivery || shop.pickupPaymentCashOnPickup) {
    badges.push({ key: "cash", label: "Cash", Icon: Banknote });
  }
  for (const provider of shop.enabledPaymentProviders) {
    badges.push({ key: provider, label: provider.charAt(0).toUpperCase() + provider.slice(1), Icon: CreditCard });
  }
  return badges;
}

function FollowUs({ socialEntries }: { socialEntries: [string, string][] }) {
  return (
    <div className="flex items-center gap-3">
      {socialEntries.map(([platform, url]) => {
        const Icon = SOCIAL_ICONS[platform];
        return (
          <a
            key={platform}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={platform}
            className="flex items-center justify-center size-8 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            {Icon && <Icon className="size-4" />}
          </a>
        );
      })}
    </div>
  );
}

function ContactList({ shop, center = false }: { shop: Shop; center?: boolean }) {
  return (
    <ul className={`space-y-2 text-sm opacity-80 ${center ? "flex flex-wrap items-center justify-center gap-x-5 gap-y-1 space-y-0" : ""}`}>
      {shop.contactNumbers?.map((number) => (
        <li key={number} className="flex items-center gap-2">
          <Phone className="size-3.5 shrink-0" />
          <a href={`tel:${number}`} className="hover:underline hover:opacity-100 transition-opacity">
            {number}
          </a>
        </li>
      ))}
      {shop.email && (
        <li className="flex items-center gap-2">
          <Mail className="size-3.5 shrink-0" />
          <a href={`mailto:${shop.email}`} className="hover:underline hover:opacity-100 transition-opacity break-all">
            {shop.email}
          </a>
        </li>
      )}
    </ul>
  );
}

// Fixed structure, configurable content — not a drag-and-drop section
// builder (explicitly out of scope). Renders as a direct sibling of
// StorefrontPageShell content in ShopLayoutClient, full-bleed, same "own
// background/width, contained inner row" pattern as TopBar/CategoryNav.
// Two real arrangements (footerLayout) — "columns" (the original, brand/
// links/social+contact side by side) and "centered" (a single simplified
// stacked column) — each independently sized via footerDensity.
export default function Footer() {
  const { shop, shopSlug } = useShop();
  if (!shop) return null;

  const socialEntries = Object.entries(shop.socialLinks ?? {}).filter(([, url]) => !!url) as [string, string][];
  const availablePolicyTypes = new Set(shop.policyPageTypes);
  const usefulLinks = POLICY_PAGE_TYPES.filter((type) => availablePolicyTypes.has(type));
  const badges = paymentBadges(shop);
  const hasContact = !!(shop.email || shop.contactNumbers?.length);
  const padding = FOOTER_DENSITY_PADDING[shop.footerDensity ?? "regular"];

  const copyrightName =
    shop.trademarkFormat === "legal" ? shop.legalName || shop.displayName || shop.name : shop.displayName || shop.name;

  const logoUrl = resolveImageUrl(shop.footerLogoUrl ?? shop.logoUrl);

  const bottomBar = (
    <div className="border-t border-white/10">
      <div className={`max-w-7xl mx-auto px-4 sm:px-6 ${padding.bottom} flex flex-col sm:flex-row items-center justify-between gap-3 text-xs opacity-70`}>
        <p>
          © {new Date().getFullYear()} {copyrightName} — All Rights Reserved
        </p>
        {badges.length > 0 && (
          <div className="flex items-center gap-2">
            {badges.map(({ key, label, Icon }) => (
              <span key={key} className="flex items-center gap-1 rounded border border-white/15 px-2 py-1">
                <Icon className="size-3.5" />
                {label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  if (shop.footerLayout === "centered") {
    return (
      <footer style={{ background: "var(--color-footer-bg)", color: "var(--color-footer-fg)" }}>
        <div className={`max-w-2xl mx-auto px-4 sm:px-6 ${padding.main} flex flex-col items-center text-center gap-4`}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={shop.displayName ?? shop.name} className="h-9 max-w-40 object-contain" />
          ) : (
            <p className="text-lg font-bold">{shop.displayName ?? shop.name}</p>
          )}
          {shop.footerDescription && <p className="text-sm opacity-75 max-w-md break-words">{shop.footerDescription}</p>}

          {usefulLinks.length > 0 && (
            <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm opacity-80">
              {usefulLinks.map((type) => (
                <li key={type}>
                  <Link href={`/${shopSlug}/policies/${POLICY_URL_SLUGS[type]}`} className="hover:underline hover:opacity-100 transition-opacity">
                    {POLICY_PAGE_LABELS[type]}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {socialEntries.length > 0 && <FollowUs socialEntries={socialEntries} />}
          {hasContact && <ContactList shop={shop} center />}
        </div>
        {bottomBar}
      </footer>
    );
  }

  return (
    <footer style={{ background: "var(--color-footer-bg)", color: "var(--color-footer-fg)" }}>
      {/* auto-fit, not a fixed grid-cols-N — a shop with nothing configured
          beyond the brand column still gets a sensible single-column
          footer instead of 3 empty reserved tracks (see the task's own
          "graceful degradation" verification requirement). */}
      {/* min-w-0 on every grid item: CSS Grid items default to
          min-width:auto, meaning a child with an unbreakable long string
          (a merchant paste with no spaces, a long URL, ...) refuses to
          shrink below that string's full width — which then blows the
          whole track (and this row, and the page) wider instead of
          wrapping. min-w-0 opts back into "shrink to the track, then wrap
          your own content" instead. */}
      <div className={`max-w-7xl mx-auto px-4 sm:px-6 ${padding.main} grid grid-cols-1 gap-10 sm:[grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]`}>
        <div className="min-w-0">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={shop.displayName ?? shop.name} className="h-9 max-w-40 object-contain mb-3" />
          ) : (
            <p className="text-lg font-bold mb-3">{shop.displayName ?? shop.name}</p>
          )}
          {shop.footerDescription && (
            <p className="text-sm opacity-75 max-w-xs break-words">{shop.footerDescription}</p>
          )}
        </div>

        {usefulLinks.length > 0 && (
          <div className="min-w-0">
            <h3 className="text-sm font-semibold mb-3">Useful Links</h3>
            <ul className="space-y-2 text-sm opacity-80">
              {usefulLinks.map((type) => (
                <li key={type}>
                  <Link href={`/${shopSlug}/policies/${POLICY_URL_SLUGS[type]}`} className="hover:underline hover:opacity-100 transition-opacity">
                    {POLICY_PAGE_LABELS[type]}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(socialEntries.length > 0 || hasContact) && (
          <div className="space-y-6 min-w-0">
            {socialEntries.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-3">Follow Us</h3>
                <FollowUs socialEntries={socialEntries} />
              </div>
            )}
            {hasContact && (
              <div>
                <h3 className="text-sm font-semibold mb-3">Contact Us</h3>
                <ContactList shop={shop} />
              </div>
            )}
          </div>
        )}
      </div>

      {bottomBar}
    </footer>
  );
}
