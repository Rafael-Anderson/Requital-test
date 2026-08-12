"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ShieldCheck, Truck, Store } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { useCart } from "@/lib/cart";
import { getProductBySlug } from "@/lib/api";
import { sanitizeDescriptionHtml } from "@/lib/sanitize-html";
import { iconStyleProps } from "@/lib/icon-style";
import { storeButtonClassName } from "@/lib/button-style";
import { buildWhatsAppUrl } from "@/lib/whatsapp-button";
import ProductGallery from "@/components/ProductGallery";
import RelatedProducts from "@/components/RelatedProducts";
import NotifyMeForm from "@/components/NotifyMeForm";
import StorefrontPageShell from "@/components/StorefrontPageShell";
import type { Product, ProductVariant, Shop } from "@/lib/types";

// One selected value id per option, in option order (index i -> product.options[i]).
type Selection = (number | null)[];

function variantOptionValueIds(v: ProductVariant): (number | null)[] {
  return [v.optionValue1Id, v.optionValue2Id, v.optionValue3Id];
}

// The backend always regenerates the FULL cartesian product of a product's
// current option values (see ProductsService.updateOptions) — there's never
// a partial/sparse combination, so any selection built from the option
// value lists always resolves to a real variant. No "unavailable
// combination" state to handle here.
function findVariant(product: Product, selection: Selection): ProductVariant | undefined {
  return product.variants.find((v) =>
    variantOptionValueIds(v).slice(0, selection.length).every((id, i) => id === selection[i]),
  );
}

function stockLabel(stock: number | null): { text: string; tone: "ok" | "low" | "out" } | null {
  if (stock === null) return { text: "In stock", tone: "ok" };
  if (stock <= 0) return { text: "Out of stock", tone: "out" };
  if (stock <= 5) return { text: `Only ${stock} left`, tone: "low" };
  return { text: "In stock", tone: "ok" };
}

function formatDeliveryEstimate(shop: Shop): string | null {
  if (!shop.estimatedDeliveryTimeFrom || !shop.estimatedDeliveryTimeTo) return null;
  return `${shop.estimatedDeliveryTimeFrom}–${shop.estimatedDeliveryTimeTo} ${shop.estimatedDeliveryTimeUnit ?? ""}`.trim();
}

export default function ProductDetailClient() {
  const params = useParams<{ shop: string; slug: string }>();
  const router = useRouter();
  const { shopSlug, shopBasePath, shop, outlets } = useShop();
  const { addItem, clear } = useCart();
  const defaultOutletId = outlets[0]?.id;

  const [product, setProduct] = useState<Product | null>(null);
  const [selection, setSelection] = useState<Selection>([]);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [added, setAdded] = useState(false);
  // Gift Cards — the denomination/custom amount the shopper picked. null
  // until they've actually chosen one, even if a default gets pre-selected
  // below (so "no selection yet" and "selected the first preset" stay
  // distinguishable while the product is loading).
  const [giftCardAmount, setGiftCardAmount] = useState<number | null>(null);
  const [customGiftCardAmount, setCustomGiftCardAmount] = useState("");

  useEffect(() => {
    getProductBySlug(shopSlug, params.slug, defaultOutletId)
      .then((p) => {
        setProduct(p);
        setSelection(p.variants[0] ? variantOptionValueIds(p.variants[0]).slice(0, p.options.length) : []);
        setGiftCardAmount(p.isGiftCard ? (p.giftCardDenominations?.[0] ?? null) : null);
        setCustomGiftCardAmount("");
      })
      .catch(() => setProduct(null));
  }, [shopSlug, params.slug, defaultOutletId]);

  const selectedVariant = useMemo(
    () => (product && product.hasVariants ? findVariant(product, selection) : undefined),
    [product, selection],
  );

  // The variant's own photo (if it has one) takes over the gallery's first
  // slot rather than living in a second, competing image area — reset to it
  // any time the selection actually changes which variant (and therefore
  // which photo) is current.
  const galleryImages = useMemo(() => {
    if (!product) return [];
    const base = product.images.length > 0 ? product.images.map((i) => i.url) : [product.thumbnail];
    if (selectedVariant?.imageUrl && !base.includes(selectedVariant.imageUrl)) {
      return [selectedVariant.imageUrl, ...base];
    }
    return base;
  }, [product, selectedVariant]);
  useEffect(() => {
    setActiveImageIndex(0);
  }, [selectedVariant?.imageUrl]);

  // Sticky mobile add-to-cart: shows once the *real* CTA has scrolled out of
  // view, so a long description/gallery never leaves the purchase action
  // more than a thumb-reach away — see the Phase 2 brief's "sticky on mobile
  // if the page is long".
  const ctaRef = useRef<HTMLDivElement>(null);
  const [ctaVisible, setCtaVisible] = useState(true);
  useEffect(() => {
    const el = ctaRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setCtaVisible(entry.isIntersecting), { threshold: 0 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [product?.id]);

  if (!product) return <p className="text-zinc-500">Loading…</p>;

  const displayPrice = product.isGiftCard ? (giftCardAmount ?? 0) : (selectedVariant?.price ?? product.price);
  const displayCompareAtPrice = product.isGiftCard ? null : (selectedVariant?.compareAtPrice ?? null);
  // A gift card isn't physical inventory — no stock concept applies (see
  // schema.prisma's comment on product.isGiftCard). null here means "don't
  // show a stock line," same as any other untracked product.
  const displayStock = product.isGiftCard ? null : product.hasVariants ? (selectedVariant?.stockQuantity ?? null) : product.stockQuantity;
  const stock = product.isGiftCard ? null : stockLabel(displayStock);
  const outOfStock = stock?.tone === "out";
  const maxQty = displayStock ?? Infinity;
  const giftCardAmountValid = !product.isGiftCard || (giftCardAmount !== null && giftCardAmount > 0);
  const zoomEnabled = shop?.productImageZoomEnabled !== false;

  const deliveryAvailable = outlets.some((o) => o.deliveryEnabled);
  const pickupAvailable = outlets.some((o) => o.pickupEnabled);
  const deliveryEstimate = shop ? formatDeliveryEstimate(shop) : null;

  // "cart" (default): normal Add to Cart. "buy_now": Add to Cart becomes a
  // single-item Buy Now that skips straight to checkout. "contact": no cart
  // interaction at all — a WhatsApp/contact CTA replaces it entirely. See
  // TopBar.tsx's CartIconButton for the matching nav-icon gate.
  const cartMode: "cart" | "buy_now" | "contact" = !shop?.disableStoreCart
    ? "cart"
    : shop.cartDisabledMode === "contact_to_order"
      ? "contact"
      : "buy_now";
  const contactWhatsAppUrl =
    cartMode === "contact"
      ? buildWhatsAppUrl(shop?.whatsappCountryCode ?? null, shop?.whatsappNumber ?? null, `Hi, I'm interested in ${product.name}`)
      : null;

  function handleAddToCart() {
    if (!product || defaultOutletId === undefined) return;
    if (product.hasVariants && !selectedVariant) return;
    if (product.isGiftCard && !giftCardAmountValid) return;
    const item = {
      productId: product.id,
      variantId: selectedVariant?.id,
      variantLabel: selectedVariant?.label ?? undefined,
      name: product.name,
      price: Number(displayPrice),
      thumbnail: galleryImages[0] ?? product.thumbnail,
      maxStock: displayStock,
      isGiftCard: product.isGiftCard || undefined,
      note: note.trim() || undefined,
    };
    if (cartMode === "buy_now") {
      // Replaces whatever's already in the cart, not merges — "buy now" is a
      // single-item purchase, not a continuation of prior browsing.
      clear();
      addItem(item, quantity, defaultOutletId);
      router.push(`${shopBasePath}/checkout`);
      return;
    }
    addItem(item, quantity, defaultOutletId);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  }

  const addToCartLabel = added
    ? "Added ✓"
    : product.isGiftCard && !giftCardAmountValid
      ? "Choose an amount"
      : outOfStock
        ? "Out of stock"
        : cartMode === "buy_now"
          ? "Buy Now"
          : "Add to cart";
  const pdpLayout = shop?.pdpLayout ?? "gallery_left";

  // Shared between the main CTA and the sticky mobile duplicate below — one
  // branch to keep in sync, not two. contact_to_order mode: WhatsApp link, or
  // a disabled-looking static button if the shop has no whatsappNumber
  // configured yet (a merchant config gap, not a shopper-facing error to
  // handle richly).
  function primaryCtaElement(className: string) {
    if (cartMode === "contact") {
      if (contactWhatsAppUrl) {
        return (
          <a
            href={contactWhatsAppUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center justify-center ${className} ${storeButtonClassName(shop, "add-to-cart")}`}
          >
            Contact to order
          </a>
        );
      }
      return (
        <span className={`inline-flex items-center justify-center opacity-50 cursor-not-allowed ${className} ${storeButtonClassName(shop, "add-to-cart")}`}>
          Contact us to order
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={handleAddToCart}
        disabled={defaultOutletId === undefined || outOfStock || !giftCardAmountValid}
        className={`${className} ${storeButtonClassName(shop, "add-to-cart")}`}
      >
        {addToCartLabel}
      </button>
    );
  }

  const galleryEl = (
    <ProductGallery
      images={galleryImages}
      activeIndex={activeImageIndex}
      onActiveIndexChange={setActiveImageIndex}
      productName={product.name}
      zoomEnabled={zoomEnabled}
    />
  );

  const infoColumn = (
        <div>
          <h1 className="text-2xl sm:text-[28px] font-semibold tracking-tight text-product-name">{product.name}</h1>

          <div className="flex items-baseline gap-2 mt-2">
            <p className="text-xl font-semibold text-product-name">
              {displayPrice} <span className="text-base font-normal text-price-main">{shop?.currency}</span>
            </p>
            {displayCompareAtPrice && (
              <p className="text-sm text-price-secondary line-through">
                {displayCompareAtPrice} {shop?.currency}
              </p>
            )}
          </div>

          {product.shortSummary && <p className="text-zinc-600 mt-3">{product.shortSummary}</p>}

          {product.hasVariants && (
            <div className="mt-5 space-y-4">
              {product.options.map((option, i) => (
                <div key={option.id}>
                  <p className="text-sm font-medium mb-1.5">
                    {option.name}
                    {selection[i] && (
                      <span className="text-zinc-500 font-normal">
                        {": "}
                        {option.values.find((v) => v.id === selection[i])?.value}
                      </span>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {option.values.map((value) => {
                      const active = selection[i] === value.id;
                      return (
                        <button
                          key={value.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setSelection((s) => s.map((v, idx) => (idx === i ? value.id : v)))}
                          className={`min-w-11 px-3.5 py-2 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${
                            active
                              ? "border-accent bg-accent/10 text-accent-text"
                              : "border-stroke hover:border-black/30"
                          }`}
                        >
                          {value.value}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Gift Cards — denomination picker (+ an optional custom-amount
              field, only rendered when the merchant configured a min/max)
              instead of the variant selectors above, which don't apply to
              this product type at all. */}
          {product.isGiftCard && (
            <div className="mt-5 space-y-3">
              {product.giftCardDenominations && product.giftCardDenominations.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1.5">Amount</p>
                  <div className="flex flex-wrap gap-2">
                    {product.giftCardDenominations.map((amount) => {
                      const active = giftCardAmount === amount && customGiftCardAmount === "";
                      return (
                        <button
                          key={amount}
                          type="button"
                          aria-pressed={active}
                          onClick={() => {
                            setGiftCardAmount(amount);
                            setCustomGiftCardAmount("");
                          }}
                          className={`min-w-16 px-3.5 py-2 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${
                            active ? "border-accent bg-accent/10 text-accent-text" : "border-stroke hover:border-black/30"
                          }`}
                        >
                          {amount} {shop?.currency}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {product.giftCardCustomAmountMin && product.giftCardCustomAmountMax && (
                <div>
                  <label className="text-sm font-medium block mb-1.5">
                    Or enter a custom amount ({product.giftCardCustomAmountMin}–{product.giftCardCustomAmountMax} {shop?.currency})
                  </label>
                  <input
                    type="number"
                    min={Number(product.giftCardCustomAmountMin)}
                    max={Number(product.giftCardCustomAmountMax)}
                    value={customGiftCardAmount}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setCustomGiftCardAmount(raw);
                      const parsed = Number(raw);
                      setGiftCardAmount(raw && !Number.isNaN(parsed) ? parsed : null);
                    }}
                    placeholder="Custom amount"
                    className="h-10 w-full max-w-40 rounded-lg border border-stroke bg-white dark:bg-zinc-900 px-3 text-sm outline-none focus:border-accent transition-colors"
                  />
                </div>
              )}
            </div>
          )}

          {/* Stock + fulfillment visibility — real data only (per-outlet
              delivery/pickup flags, per-variant stock when tracked), never
              fabricated messaging. Doesn't apply to a gift card (no stock,
              no physical fulfillment) — see the trust row below instead. */}
          {!product.isGiftCard && (
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              {stock && (
                <span
                  className={`font-medium ${
                    stock.tone === "out" ? "text-red-600" : stock.tone === "low" ? "text-amber-600" : "text-green-700 dark:text-green-500"
                  }`}
                >
                  {stock.tone === "ok" ? "● " : ""}
                  {stock.text}
                </span>
              )}
              {deliveryAvailable && <span className="text-zinc-500">Delivery available</span>}
              {pickupAvailable && <span className="text-zinc-500">Pickup available</span>}
            </div>
          )}

          <div ref={ctaRef} className="mt-5 flex items-center gap-3">
            {cartMode !== "contact" && (
              <div className="flex items-center border border-stroke rounded-lg shrink-0">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={outOfStock}
                  className="px-3 py-2.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <span className="px-3 min-w-8 text-center">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
                  disabled={outOfStock}
                  className="px-3 py-2.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
            )}
            {primaryCtaElement("flex-1 h-12 font-semibold text-[15px] shadow-sm shadow-black/10")}
          </div>

          {cartMode !== "contact" && (
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              placeholder="Add a note for this item (optional)"
              className="mt-3 w-full rounded-lg border border-stroke px-3 py-2 text-sm placeholder:text-zinc-400"
            />
          )}

          {!product.isGiftCard && outOfStock && (
            <NotifyMeForm productId={product.id} variantId={selectedVariant?.id} />
          )}

          {/* Trust row — secure checkout is a factual claim about how
              checkout works, not shop-specific policy copy; the delivery
              estimate is real shop.estimatedDeliveryTime* data or omitted
              entirely, never invented. No return/refund-policy field exists
              on Shop today, so no such badge is shown — see the Phase 2 report. */}
          <div className="mt-5 flex flex-col gap-2 text-xs text-zinc-500">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 shrink-0" {...iconStyleProps(shop?.iconStyle, 2)} />
              <span>Secure checkout</span>
            </div>
            {product.isGiftCard ? (
              <div className="flex items-center gap-1.5">
                <Truck className="size-3.5 shrink-0" {...iconStyleProps(shop?.iconStyle, 2)} />
                <span>Delivered by email, no shipping required</span>
              </div>
            ) : (
              <>
                {deliveryAvailable && (
                  <div className="flex items-center gap-1.5">
                    <Truck className="size-3.5 shrink-0" {...iconStyleProps(shop?.iconStyle, 2)} />
                    <span>{deliveryEstimate ? `Delivery in ${deliveryEstimate}` : "Delivery available at checkout"}</span>
                  </div>
                )}
                {pickupAvailable && (
                  <div className="flex items-center gap-1.5">
                    <Store className="size-3.5 shrink-0" {...iconStyleProps(shop?.iconStyle, 2)} />
                    <span>Pickup available at checkout</span>
                  </div>
                )}
              </>
            )}
          </div>

          {product.description && (
            <div
              className="mt-6 pt-6 border-t border-stroke text-[15px] text-zinc-600 leading-relaxed [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-product-name [&_h2]:mt-4 [&_h2]:mb-1.5 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-accent-text [&_a]:underline"
              // Sanitized against a fixed allowlist matching exactly what
              // admin's RichTextEditor toolbar can produce — see
              // lib/sanitize-html.ts.
              dangerouslySetInnerHTML={{ __html: sanitizeDescriptionHtml(product.description) }}
            />
          )}

          {product.showAttributes && product.attributes.length > 0 && (
            <div className="mt-6 pt-6 border-t border-stroke">
              <h2 className="text-base font-semibold text-product-name mb-2">Details</h2>
              <dl className="text-sm divide-y divide-stroke">
                {product.attributes.map((attr) => (
                  <div key={attr.id} className="flex justify-between gap-4 py-1.5">
                    <dt className="text-zinc-500">{attr.name}</dt>
                    <dd className="text-right">{attr.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {product.showFaqs && product.faqs.length > 0 && (
            <div className="mt-6 pt-6 border-t border-stroke">
              <h2 className="text-base font-semibold text-product-name mb-2">FAQs</h2>
              <div className="space-y-1">
                {product.faqs.map((faq) => (
                  <details key={faq.id} className="text-sm py-1.5">
                    <summary className="font-medium cursor-pointer select-none">{faq.question}</summary>
                    <p className="mt-1.5 text-zinc-600">{faq.answer}</p>
                  </details>
                ))}
              </div>
            </div>
          )}
        </div>
  );

  return (
    <StorefrontPageShell variant="wide">
      {pdpLayout === "gallery_top" ? (
        // Full-width gallery up top, details below — a genuinely different
        // component tree (single column, gallery unconstrained to half the
        // viewport width) not just a narrower grid column. See the Theme
        // Customizer v2 brief's PDP layout presets.
        <div className="flex flex-col gap-8">
          <div className="sm:max-w-2xl sm:mx-auto w-full">{galleryEl}</div>
          <div className="sm:max-w-2xl sm:mx-auto w-full">{infoColumn}</div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-10">
          {galleryEl}
          {infoColumn}
        </div>
      )}

      <RelatedProducts productSlug={product.slug} excludeProductId={product.id} outletId={defaultOutletId} />

      {/* Sticky mobile bar — mirrors the real CTA above, only shown once
          that one has scrolled out of view. */}
      {!ctaVisible && (
        <div className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-header border-t border-stroke px-4 py-3 flex items-center gap-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
          <div className="min-w-0">
            <p className="text-xs text-zinc-500 truncate">{product.name}</p>
            <p className="font-semibold text-product-name">
              {displayPrice} <span className="text-xs font-normal text-price-main">{shop?.currency}</span>
            </p>
          </div>
          {primaryCtaElement("flex-1 h-11 font-semibold text-sm")}
        </div>
      )}
    </StorefrontPageShell>
  );
}
