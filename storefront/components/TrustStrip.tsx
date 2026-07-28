import { Gift, ShieldCheck, Truck } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { iconStyleProps } from "@/lib/icon-style";

// Generic, vertical-agnostic trust signals — this platform serves more than
// florists, so copy avoids anything flower-specific (see the storefront
// design audit: the checkout/homepage had zero trust signals anywhere).
// Icon chips use color-mix against the existing --color-accent variable, not
// a new color token, so this automatically follows whatever brand color the
// merchant has already set in Theme.
const ITEMS = [
  { icon: Truck, label: "Fast delivery", desc: "Delivered fresh to your door" },
  { icon: ShieldCheck, label: "Secure checkout", desc: "Your payment is protected" },
  { icon: Gift, label: "Thoughtfully packaged", desc: "Ready to gift, every time" },
];

// Renders as its own full-width band (border-y spans edge to edge) — the
// caller places this outside StorefrontPageShell, same as the homepage
// hero, rather than nested inside it. A contained max-w-7xl row holds the
// actual icon/text content, same "full-width bar, contained inner row"
// pattern TopBar/CategoryNav already use. Previously this rendered as a
// plain grid nested *inside* the wide shell, so its border-y lines only
// ever spanned the shell's own padded content width (visibly narrower than
// the page, and inconsistent with the hero directly above it going truly
// edge to edge) — see the storefront layout-bugs report.
export default function TrustStrip() {
  const { shop } = useShop();
  return (
    <div className="border-y border-stroke">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 grid grid-cols-1 sm:grid-cols-3 gap-6 py-6">
        {ITEMS.map(({ icon: Icon, label, desc }) => (
          <div key={label} className="flex items-center gap-3">
            <div
              className="flex items-center justify-center size-10 rounded-full shrink-0"
              style={{ background: "color-mix(in srgb, var(--color-accent) 12%, transparent)" }}
            >
              <Icon className="size-5 text-accent" {...iconStyleProps(shop?.iconStyle)} />
            </div>
            <div>
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-zinc-500">{desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
