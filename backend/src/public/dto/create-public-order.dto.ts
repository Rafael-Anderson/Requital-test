import { Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_LINE_QUANTITY, MAX_ORDER_LINES } from '../../common/order-limits';

class PublicOrderItemInput {
  @IsInt()
  @IsPositive()
  productId: number;

  // Required when the product has options configured, omitted otherwise —
  // enforced in ProductsService.resolveOrderItems, not here (needs a DB
  // lookup to know whether the product has variants).
  @IsOptional()
  @IsInt()
  @IsPositive()
  variantId?: number;

  @IsInt()
  @IsPositive()
  @Max(MAX_LINE_QUANTITY)
  quantity: number;

  // Only meaningful (and only accepted — see ProductsService.resolveOrderItems)
  // when productId refers to a product with isGiftCard: true, since that
  // product's own `price` is just a placeholder — this is the actual
  // denomination/custom amount the shopper picked. Validated server-side
  // against that product's configured denominations/min/max either way, so
  // a client can't smuggle an arbitrary price through this field for a
  // regular product.
  @IsOptional()
  @IsNumber()
  @Min(0)
  giftCardAmount?: number;

  // Optional note the customer typed on the product page (e.g. "no card,
  // please") — carried through to orderitem.note verbatim, staff-facing
  // only, never validated/parsed for content.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export const PAYMENT_METHODS = [
  'card_online',
  'cash_on_delivery',
  'card_on_delivery',
  'cash_on_pickup',
  'card_on_pickup',
  // Independent online providers from the Payment Gateways settings page —
  // see PublicService's INDEPENDENT_ONLINE_PROVIDERS/assertPaymentMethodAvailable.
  'paypal',
  'tabby',
  'tamara',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export class CreatePublicOrderDto {
  @IsInt()
  @IsPositive()
  outletId: number;

  @IsIn(['delivery', 'pickup'])
  orderType: 'delivery' | 'pickup';

  @IsIn(PAYMENT_METHODS)
  paymentMethod: PaymentMethod;

  @IsString()
  @IsNotEmpty()
  customerName: string;

  // Digits, spaces, hyphens, and an optional leading "+" only — matches the
  // storefront checkout's client-side sanitizer (lib/phone.ts) exactly, but
  // enforced here too since the client-side strip is a UX nicety, not the
  // actual guarantee.
  @Matches(/^\+?[0-9][0-9\s-]{5,19}$/, {
    message:
      'customerPhone must contain only digits, spaces, hyphens, and an optional leading +',
  })
  customerPhone: string;

  @IsOptional()
  @IsString()
  customerEmail?: string;

  // Required even for pickup — the storefront pre-fills a "Pickup at
  // <outlet>" placeholder for that flow, mirroring how customerAddress is
  // unconditionally required in the admin's CreateOrderDto today.
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  customerAddress: string;

  // The region, by id. Options come from GET /regions (staff) or
  // GET /public/:shopSlug/regions (storefront).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  regionId?: number;

  @IsOptional()
  @IsString()
  area?: string;

  // Only meaningful for delivery — used to check against the outlet's
  // deliveryRadiusKm. Omitted for pickup, or for a delivery customer who
  // typed their address manually instead of using geolocation (radius
  // eligibility can't be verified in that case — see PublicService.createOrder).
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  // Set by the storefront only while Google Maps is unavailable to the shopper
  // and no pin was given. The server then geocodes the typed address (radius
  // outlets) or accepts it, and flags the order addressUnverified. Ignored when
  // coordinates are present.
  @IsOptional()
  @IsBoolean()
  addressManual?: boolean;

  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  @IsOptional()
  @IsString()
  deliveryTimeSlot?: string;

  @IsOptional()
  @IsString()
  deliveryNotes?: string;

  @IsOptional()
  @IsString()
  receiverMessage?: string;

  // MKT-14: first/last-touch UTM + referrer + click ids and the cookie-consent
  // state, captured client-side. Deliberately a bare object here, not a nested
  // validated DTO: attribution is untrusted marketing metadata and must never
  // turn a real order into a 400. sanitizeAttribution (shop-analytics/
  // attribution.ts) bounds and filters it, and drops click ids / fbp / fbc / user
  // agent unless marketing consent is explicitly true.
  @IsOptional()
  @Allow()
  attribution?: Record<string, unknown>;

  // Captured client-side from ?ref=<code> on any storefront page load and
  // persisted (see storefront/lib/referral.ts) — resolved server-side
  // against AffiliateService; an unknown/expired/blocked code is silently
  // ignored rather than blocking checkout (see PublicService.createOrder).
  @IsOptional()
  @IsString()
  referralCode?: string;

  // Re-validated and atomically claimed server-side at creation time (see
  // PublicService.createOrder) — a client-supplied discountAmount is never
  // trusted, only the code itself. An invalid/expired/exhausted code
  // rejects the whole checkout (400), unlike referralCode, which is
  // silently dropped instead — the customer explicitly typed this code and
  // expects it applied.
  @IsOptional()
  @IsString()
  discountCode?: string;

  // Re-validated and atomically claimed server-side (see
  // PublicService.createOrder + GiftCardsService.redeem), same "code
  // trusted, not any client-supplied amount" discipline as discountCode.
  // Applies up to min(remainingBalance, order total); combines with
  // whichever paymentMethod is selected for any remainder — never a
  // payment method on its own.
  @IsOptional()
  @IsString()
  giftCardCode?: string;

  // CUS-6. A bare yes/no: the AMOUNT is never client-supplied. The server reads
  // the logged-in customer's balance in this shop's currency and applies up to
  // what is still payable after tax, discount and gift card. Needs a customer
  // session (401 without one). Combines with any paymentMethod for the remainder.
  @IsOptional()
  @IsBoolean()
  useStoreCredit?: boolean;

  // F8: one opaque key per checkout ATTEMPT, minted by the storefront (a UUID kept
  // in sessionStorage). A retry of the same attempt (double click, a response that
  // never arrived, Back from the gateway) carries the same key and gets the SAME
  // order back, never a second order or a second debit; the same key with a
  // different request is a 409. Optional: no key = the old behaviour.
  @IsOptional()
  @IsString()
  // A UUID, or at least 22 URL-safe characters (128 bits of base64url): a key is
  // the only thing that lets a request be answered with someone's order, so a
  // short or guessable one is refused.
  @Matches(
    /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[A-Za-z0-9_-]{22,64})$/,
    {
      message:
        'idempotencyKey must be a UUID or 22 to 64 letters, digits, - or _',
    },
  )
  idempotencyKey?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_ORDER_LINES)
  @ValidateNested({ each: true })
  @Type(() => PublicOrderItemInput)
  items: PublicOrderItemInput[];
}
