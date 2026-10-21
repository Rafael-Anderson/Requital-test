"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useShop } from "@/lib/shop-context";
import { quoteCartTax } from "@/lib/order-tax";
import { buildQuoteRequest, quoteBlocksSubmit, useDeliveryQuote } from "@/lib/useDeliveryQuote";
import { useCart } from "@/lib/cart";
import { useAuth } from "@/lib/auth";
import { captureAbandonedCart, createOrder, listMyAddresses } from "@/lib/api";
import { generateTimeSlots, isDateBlocked, localDateKey } from "@/lib/slots";
import { resolvePaymentMethods } from "@/lib/payment-methods";
import { effectiveOrderType, resolveFulfilmentOptions } from "@/lib/fulfilment";
import { getStoredReferralCode } from "@/lib/referral";
import { sanitizePhoneInput } from "@/lib/phone";
import { track, type AnalyticsItem } from "@/lib/analytics";
import { buildOrderAttribution } from "@/lib/attribution";
import { buildPurchasePayload, stashPurchase } from "@/lib/purchase-tracking";
import type { CustomerAddress, OrderType, PaymentMethod } from "@/lib/types";

function cartAnalyticsItems(items: { productId: number; name: string; price: number; quantity: number; variantLabel?: string }[]): AnalyticsItem[] {
  return items.map((i) => ({ id: i.productId, name: i.name, price: i.price, quantity: i.quantity, variant: i.variantLabel }));
}

// All checkout state, derived values, and submit handling — pulled out of
// the page component so both the single-page and step-by-step presets (see
// theme.checkoutLayout, Theme Customizer v2) render off the exact same
// logic. Every field/validation/submission behavior is identical between
// the two presets; only how the fields are grouped and paged through
// differs, entirely in the presentational components that call this.
export function useCheckoutForm() {
  const router = useRouter();
  const { shopSlug, shopBasePath, shop, outlets } = useShop();
  const { items, subtotal, discountCode, giftCardCode, clear } = useCart();
  const { customer } = useAuth();
  const [discountAmount, setDiscountAmount] = useState<number | null>(null);
  // The amount actually applied is capped server-side at min(remaining
  // balance, order total) — this local value is just the card's remaining
  // balance (from the live validate call), so it can over-apply relative to
  // the true total here; the display below already clamps with Math.max(0, ...),
  // and the server is the only one that ever actually draws down the balance.
  const [giftCardAmount, setGiftCardAmount] = useState<number | null>(null);
  // CUS-6: only a yes/no. How much is applied is the server's call.
  const [useStoreCredit, setUseStoreCredit] = useState(false);
  const total = Math.max(0, subtotal - (discountAmount ?? 0) - (giftCardAmount ?? 0));
  // The tax quote shown at checkout. A display mirror of the server's per-line
  // computation (see lib/order-tax.ts) - the server recomputes and charges its
  // own number at order creation. Computed once here so both checkout layouts
  // show the identical figure.
  const taxQuote = quoteCartTax({
    lines: items.map((i) => ({
      amount: i.price * i.quantity,
      taxRate: i.taxRate,
    })),
    discountAmount: discountAmount ?? 0,
    taxInclusive: Boolean(shop?.taxInclusive),
    fallbackRate: Number(shop?.taxRate ?? 0),
  });

  const deliveryPaymentMethods = resolvePaymentMethods(shop, "delivery");
  const pickupPaymentMethods = resolvePaymentMethods(shop, "pickup");

  // Outlet first: what can be chosen (delivery, pickup or both) is decided per
  // outlet by resolveFulfilmentOptions, so an outlet that offers nothing is never
  // listed and the order type is derived from the selected outlet, never stored
  // next to it (see lib/fulfilment.ts).
  const outletOptions = outlets.filter((o) => resolveFulfilmentOptions(shop, o).mode !== "none");
  const [outletId, setOutletId] = useState<number | null>(null);
  useEffect(() => {
    if (outletOptions.length > 0 && (outletId === null || !outletOptions.some((o) => o.id === outletId))) {
      setOutletId(outletOptions[0].id);
    }
  }, [outletOptions, outletId]);
  const selectedOutlet = outletOptions.find((o) => o.id === outletId) ?? null;
  // With no usable outlet, resolve against the first one so the reason is
  // specific ("outlet offers neither" vs "no payment method").
  const fulfilment = resolveFulfilmentOptions(shop, selectedOutlet ?? outlets[0] ?? null);
  // The shopper's preference survives an outlet switch: A (both) -> B (delivery
  // only) -> A shows their pickup choice again.
  const [preferredOrderType, setOrderType] = useState<OrderType>("delivery");
  const orderType = effectiveOrderType(fulfilment, preferredOrderType);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhoneRaw] = useState("");
  // Sanitized once here rather than at each presentational component's
  // input onChange — both the single-page and step-by-step layouts get the
  // same phone-input filtering for free, with no risk of one preset
  // forgetting to apply it.
  const setCustomerPhone = (value: string) => setCustomerPhoneRaw(sanitizePhoneInput(value));
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  // No default: a silent "Dubai" picked a zone fee the customer never chose. The
  // region field is required for delivery (the browser enforces it), and there is
  // none for pickup, where the customer gives no address.
  const [regionId, setRegionId] = useState<number | null>(null);
  const [area, setArea] = useState("");
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryTimeSlot, setDeliveryTimeSlot] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [submitting, setSubmitting] = useState(false);
  // A ref as well as state: two submit events in the same tick both see the old
  // state, and only the ref closes that gap.
  const submitInFlight = useRef(false);

  // begin_checkout, once per visit to this page, as soon as the cart (restored
  // from localStorage after mount) actually has something in it. A ref, not state:
  // nothing renders from it.
  const beganCheckout = useRef(false);
  useEffect(() => {
    if (beganCheckout.current || items.length === 0) return;
    beganCheckout.current = true;
    track("begin_checkout", { items: cartAnalyticsItems(items), value: subtotal });
  }, [items, subtotal]);

  // The server's delivery fee and totals for what is in the cart right now (same
  // pricing as order creation). Drives the summary and blocks Place order when
  // the server says this cart cannot be delivered as asked.
  const { state: deliveryQuote, retry: retryDeliveryQuote } = useDeliveryQuote(
    shopSlug,
    buildQuoteRequest({ items, outletId, orderType, regionId, area, coords, discountCode }),
  );
  const quoteBlocked = quoteBlocksSubmit(deliveryQuote);

  const [error, setError] = useState<string | null>(null);

  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (!customer || prefilled) return;
    setCustomerName((v) => v || customer.name);
    setCustomerPhoneRaw((v) => v || sanitizePhoneInput(customer.phone));
    setCustomerEmail((v) => v || customer.email || "");
    setPrefilled(true);
  }, [customer, prefilled]);

  const [savedAddresses, setSavedAddresses] = useState<CustomerAddress[]>([]);
  useEffect(() => {
    if (!customer) {
      setSavedAddresses([]);
      return;
    }
    listMyAddresses(shopSlug)
      .then(setSavedAddresses)
      .catch(() => setSavedAddresses([]));
  }, [customer, shopSlug]);

  function applySavedAddress(address: CustomerAddress) {
    setCustomerAddress(address.address);
    setRegionId(address.regionId ?? null);
    setArea(address.area ?? "");
    if (address.latitude !== undefined && address.longitude !== undefined) {
      setCoords({ latitude: address.latitude, longitude: address.longitude });
    } else {
      setCoords(null);
    }
  }

  const availablePaymentMethods = orderType === "pickup" ? pickupPaymentMethods : deliveryPaymentMethods;
  useEffect(() => {
    if (!paymentMethod || !availablePaymentMethods.includes(paymentMethod)) {
      setPaymentMethod(availablePaymentMethods[0] ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderType, JSON.stringify(availablePaymentMethods)]);

  const today = new Date();
  const minDate = localDateKey(today);
  const dateForSlots = deliveryDate ? new Date(deliveryDate) : today;
  const relevantHours = orderType === "pickup" ? shop?.pickupHours ?? null : shop?.deliveryHours ?? null;
  const gapMinutes = orderType === "pickup" ? shop?.pickupTimeSlotGapMinutes ?? 30 : shop?.deliveryTimeSlotGapMinutes ?? 60;
  const dateIsToday = deliveryDate === minDate;

  // Re-ticks every 60s so a slot that expires while the shopper lingers on
  // this page disappears from the picker on its own, rather than only ever
  // being caught at submit time (the server independently re-validates
  // regardless — see backend PublicService.assertValidTimeSlot — this is
  // just so the UI doesn't keep offering something already-stale).
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);
  // Only meaningful (passed through) when the target date is genuinely
  // today — a future date's slots are never cutoff-filtered.
  const nowMinutes = new Date(nowTick).getHours() * 60 + new Date(nowTick).getMinutes();
  const timeSlots = useMemo(
    () => generateTimeSlots(dateForSlots, relevantHours, gapMinutes, dateIsToday || !deliveryDate ? nowMinutes : undefined),
    [dateForSlots.getTime(), relevantHours, gapMinutes, dateIsToday, deliveryDate, nowMinutes],
  );
  // Independent of whatever date is currently selected — drives the
  // calendar's own "today" cell greying out once nothing's left, even if
  // the shopper has already moved on to picking a later date.
  const todayFullyBooked = useMemo(
    () => generateTimeSlots(today, relevantHours, gapMinutes, nowMinutes).length === 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [relevantHours, gapMinutes, nowMinutes],
  );
  const dateBlocked = isDateBlocked(deliveryDate, today, shop?.allowSameDayOrders, shop?.allowNextDayOrders);

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError("Geolocation isn't available in this browser. Search your address instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setError("Couldn't get your location. Search your address instead, or enter it manually.");
        setLocating(false);
      },
    );
  }

  // Fired on phone-field blur (see the two checkout presentational
  // components) once name+phone are both filled in — the "customer has
  // provided enough identity to be reachable" trigger point the Abandoned
  // Cart Recovery feature is built around. Fire-and-forget: never surfaced
  // to the shopper, never blocks or delays anything else on this page.
  function notifyAbandonedCart() {
    if (!customerName.trim() || !customerPhone.trim() || items.length === 0) return;
    captureAbandonedCart(shopSlug, {
      customerName,
      customerPhone,
      customerEmail: customerEmail || undefined,
      outletId: outletId ?? undefined,
      cartItems: items.map((i) => ({
        productId: i.productId,
        variantId: i.variantId,
        name: i.name,
        variantLabel: i.variantLabel,
        price: i.price,
        quantity: i.quantity,
        thumbnail: i.thumbnail,
      })),
    }).catch(() => {
      // Never surfaced — a failed capture just means no recovery email,
      // not a checkout problem.
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orderType || !outletId || !paymentMethod || quoteBlocked || submitInFlight.current) return;
    submitInFlight.current = true;
    setSubmitting(true);
    setError(null);
    let redirecting = false;
    try {
      track("add_payment_info", { items: cartAnalyticsItems(items), value: subtotal, paymentType: paymentMethod });
      const res = await createOrder(shopSlug, {
        outletId,
        orderType,
        paymentMethod,
        customerName,
        customerPhone,
        customerEmail: customerEmail || undefined,
        // A pickup order never carries a typed delivery address, even one entered
        // before the shopper (or an outlet switch) moved it to pickup.
        customerAddress: orderType === "pickup" ? `Pickup at ${selectedOutlet?.name}` : customerAddress,
        regionId: orderType === "delivery" ? (regionId ?? undefined) : undefined,
        area: area || undefined,
        latitude: orderType === "delivery" ? coords?.latitude : undefined,
        longitude: orderType === "delivery" ? coords?.longitude : undefined,
        deliveryDate: deliveryDate || undefined,
        deliveryTimeSlot: deliveryTimeSlot || undefined,
        deliveryNotes: deliveryNotes || undefined,
        referralCode: getStoredReferralCode(shopSlug) ?? undefined,
        discountCode: discountCode ?? undefined,
        items: items.map((i) => ({
          productId: i.productId,
          variantId: i.variantId,
          quantity: i.quantity,
          giftCardAmount: i.isGiftCard ? i.price : undefined,
          note: i.note,
        })),
        giftCardCode: giftCardCode || undefined,
        useStoreCredit: useStoreCredit || undefined,
        // MKT-14: where this order came from + the cookie-consent state at this
        // moment. Click ids / fbp / fbc are included only if the visitor accepted.
        attribution: buildOrderAttribution(shopSlug),
      });
      const purchase = buildPurchasePayload(
        { id: res.order.id, total: res.order.total, currency: res.order.currency },
        cartAnalyticsItems(items),
      );
      if (res.checkoutUrl) {
        // Leaves for the gateway: the browser purchase event is sent when the
        // customer returns (orders/<token>, once the server says paid), see lib/purchase-tracking.ts.
        stashPurchase(res.order.id, purchase);
        // Stay "submitting" while the browser leaves: re-enabling the button here
        // would let a second click place a second order.
        redirecting = true;
        window.location.href = res.checkoutUrl;
        return;
      }
      track("purchase", purchase);
      clear();
      // The confirmation page reads the order with its tracking token, never its
      // sequential id (an id in a URL must not open an order).
      router.push(
        res.order.trackingToken
          ? `${shopBasePath}/orders/${res.order.trackingToken}`
          : `${shopBasePath}/orders/track`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not place order");
    } finally {
      if (!redirecting) {
        submitInFlight.current = false;
        setSubmitting(false);
      }
    }
  }

  // A time slot is required once (and only once) a delivery/pickup date has
  // been picked — the date itself stays optional. See backend
  // PublicService.assertValidTimeSlot for the authoritative, server-side
  // version of this same requirement.
  const canSubmit =
    !submitting &&
    !quoteBlocked &&
    !!orderType &&
    !!paymentMethod &&
    availablePaymentMethods.includes(paymentMethod) &&
    !dateBlocked &&
    (!deliveryDate || !!deliveryTimeSlot) &&
    (selectedOutlet ? selectedOutlet.isOpen : false);

  // Why Place order is off, in words, for the cases the page does not already
  // explain next to the field (a closed outlet and an unavailable delivery have
  // their own messages). null while the button is enabled or the reason is shown
  // elsewhere.
  const blockedReason =
    canSubmit || submitting
      ? null
      : availablePaymentMethods.length === 0
        ? "No payment method is available for this order."
        : deliveryDate && !deliveryTimeSlot
          ? "Choose a time slot to place your order."
          : null;

  return {
    shopSlug,
    shop,
    items,
    subtotal,
    taxQuote,
    total,
    deliveryQuote,
    retryDeliveryQuote,
    quoteBlocked,
    discountAmount,
    setDiscountAmount,
    giftCardAmount,
    setGiftCardAmount,
    useStoreCredit,
    setUseStoreCredit,
    fulfilment,
    orderType,
    setOrderType,
    outletOptions,
    outletId,
    setOutletId,
    selectedOutlet,
    customerName,
    setCustomerName,
    customerPhone,
    setCustomerPhone,
    customerEmail,
    setCustomerEmail,
    customerAddress,
    setCustomerAddress,
    regionId,
    setRegionId,
    area,
    setArea,
    coords,
    setCoords,
    locating,
    useMyLocation,
    deliveryNotes,
    setDeliveryNotes,
    deliveryDate,
    setDeliveryDate,
    deliveryTimeSlot,
    setDeliveryTimeSlot,
    paymentMethod,
    setPaymentMethod,
    availablePaymentMethods,
    submitting,
    error,
    savedAddresses,
    applySavedAddress,
    handleSubmit,
    notifyAbandonedCart,
    minDate,
    timeSlots,
    dateIsToday,
    dateBlocked,
    todayFullyBooked,
    canSubmit,
    blockedReason,
  };
}

export type CheckoutFormState = ReturnType<typeof useCheckoutForm>;
