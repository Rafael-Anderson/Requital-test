"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useShop } from "@/lib/shop-context";
import { useCart } from "@/lib/cart";
import { useAuth } from "@/lib/auth";
import { captureAbandonedCart, createOrder, listMyAddresses } from "@/lib/api";
import { generateTimeSlots, isDateBlocked } from "@/lib/slots";
import { resolvePaymentMethods } from "@/lib/payment-methods";
import { getStoredReferralCode } from "@/lib/referral";
import { sanitizePhoneInput } from "@/lib/phone";
import { EMIRATES } from "@/lib/types";
import type { CustomerAddress, OrderType, PaymentMethod } from "@/lib/types";

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
  const total = Math.max(0, subtotal - (discountAmount ?? 0) - (giftCardAmount ?? 0));

  const deliveryOutlets = outlets.filter((o) => o.deliveryEnabled);
  const pickupOutlets = outlets.filter((o) => o.pickupEnabled);
  const deliveryPaymentMethods = resolvePaymentMethods(shop, "delivery");
  const pickupPaymentMethods = resolvePaymentMethods(shop, "pickup");
  const deliveryAvailable = deliveryOutlets.length > 0 && deliveryPaymentMethods.length > 0;
  const pickupAvailable = pickupOutlets.length > 0 && pickupPaymentMethods.length > 0;

  const [orderType, setOrderType] = useState<OrderType | null>(null);
  useEffect(() => {
    if (orderType) return;
    if (deliveryAvailable) setOrderType("delivery");
    else if (pickupAvailable) setOrderType("pickup");
  }, [deliveryAvailable, pickupAvailable, orderType]);

  const outletOptions = orderType === "pickup" ? pickupOutlets : deliveryOutlets;
  const [outletId, setOutletId] = useState<number | null>(null);
  useEffect(() => {
    if (outletOptions.length > 0 && (outletId === null || !outletOptions.some((o) => o.id === outletId))) {
      setOutletId(outletOptions[0].id);
    }
  }, [outletOptions, outletId]);
  const selectedOutlet = outletOptions.find((o) => o.id === outletId) ?? null;

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhoneRaw] = useState("");
  // Sanitized once here rather than at each presentational component's
  // input onChange — both the single-page and step-by-step layouts get the
  // same phone-input filtering for free, with no risk of one preset
  // forgetting to apply it.
  const setCustomerPhone = (value: string) => setCustomerPhoneRaw(sanitizePhoneInput(value));
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [emirate, setEmirate] = useState<string>(EMIRATES[1]); // Dubai default
  const [area, setArea] = useState("");
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryTimeSlot, setDeliveryTimeSlot] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [submitting, setSubmitting] = useState(false);
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
    setEmirate(address.emirate);
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
  const minDate = today.toISOString().slice(0, 10);
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
      setError("Geolocation isn't available in this browser — search your address instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setError("Couldn't get your location — search your address instead, or enter it manually.");
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
    if (!orderType || !outletId || !paymentMethod) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await createOrder(shopSlug, {
        outletId,
        orderType,
        paymentMethod,
        customerName,
        customerPhone,
        customerEmail: customerEmail || undefined,
        customerAddress: orderType === "pickup" ? customerAddress || `Pickup at ${selectedOutlet?.name}` : customerAddress,
        emirate,
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
      });
      if (res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
        return;
      }
      sessionStorage.setItem(`requital_order:${res.order.id}`, JSON.stringify(res.order));
      clear();
      router.push(`${shopBasePath}/orders/${res.order.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not place order");
    } finally {
      setSubmitting(false);
    }
  }

  // A time slot is required once (and only once) a delivery/pickup date has
  // been picked — the date itself stays optional. See backend
  // PublicService.assertValidTimeSlot for the authoritative, server-side
  // version of this same requirement.
  const canSubmit =
    !submitting &&
    !!orderType &&
    !!paymentMethod &&
    !dateBlocked &&
    (!deliveryDate || !!deliveryTimeSlot) &&
    (selectedOutlet ? selectedOutlet.isOpen : false);

  return {
    shopSlug,
    shop,
    items,
    subtotal,
    total,
    discountAmount,
    setDiscountAmount,
    giftCardAmount,
    setGiftCardAmount,
    deliveryAvailable,
    pickupAvailable,
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
    emirate,
    setEmirate,
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
  };
}

export type CheckoutFormState = ReturnType<typeof useCheckoutForm>;
