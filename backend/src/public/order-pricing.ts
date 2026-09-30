import { haversineDistanceKm } from '../common/geo';

// A line as handed to the tax computation: its money amount as charged, and the
// rate its own tax class carries. `taxRate` is a percentage.
//
// `amount` is the line total (unit price x quantity) BEFORE any order-level
// discount — the discount is apportioned across lines here so that one
// apportionment rule exists rather than one per call site.
export interface TaxableLine {
  amount: number;
  taxRate: number;
  // Carried through untouched so the caller can persist the capture without
  // re-deriving which class it resolved. NULL means the line had no class of its
  // own and fell back to the shop default.
  taxClassId: number | null;
}

export interface ComputedLineTax {
  taxClassId: number | null;
  taxRate: number;
  // The line's share of the discounted subtotal, on a TAX-EXCLUSIVE basis. On an
  // inclusive shop this is less than the amount charged, because the charged
  // amount contains the tax.
  taxableAmount: number;
  taxAmount: number;
}

export interface OrderTotals {
  // What goes in `order.taxAmount`: every line's tax plus the delivery fee's,
  // when the shop taxes delivery.
  taxAmount: number;
  total: number;
  // Per line, in the same order the lines came in, for the orderitem capture.
  lines: ComputedLineTax[];
  // Grouped by rate, for a VAT invoice's "of which tax" table. Sorted by rate
  // descending so the standard rate leads.
  breakdown: { taxRate: number; taxableAmount: number; taxAmount: number }[];
  deliveryTaxAmount: number;
}

// Tax is computed PER LINE against that line's own class, not once against the
// whole subtotal — a shop selling a standard-rated bouquet and a zero-rated food
// item in one basket owes tax on the first only. Before this, one shop-level
// rate was applied to the entire goods subtotal and `product.chargeTax` was
// ignored outright, so a merchant with anything zero-rated or exempt overcharged
// VAT and filed a wrong return (capability audit I18N-5).
//
// Delivery is taxed only when the shop opts in via `shop.taxOnDelivery`, which
// defaults false — the behaviour this function has always had, and what its
// original header comment asked to revisit.
export function computeOrderTotals(params: {
  lines: TaxableLine[];
  deliveryFee: number;
  // An order-level discount (a code, or a manual adjustment). Apportioned across
  // lines pro rata by line amount, because it reduces the taxable base and with
  // mixed rates there is no single base to reduce. Tax is owed on what the
  // customer actually pays for the goods, not the pre-discount list price.
  discountAmount?: number;
  taxInclusive: boolean;
  taxOnDelivery?: boolean;
  // The rate delivery is charged at when taxOnDelivery is on — the shop's
  // default (standard) class. Delivery is a service the shop supplies; it has no
  // tax class of its own in this model.
  deliveryTaxRate?: number;
}): OrderTotals {
  const {
    lines,
    deliveryFee,
    discountAmount = 0,
    taxInclusive,
    taxOnDelivery = false,
    deliveryTaxRate = 0,
  } = params;

  const grossSubtotal = lines.reduce((sum, l) => sum + l.amount, 0);
  // A discount larger than the basket cannot make the taxable base negative.
  const effectiveDiscount = Math.min(
    Math.max(discountAmount, 0),
    grossSubtotal,
  );

  const computed: ComputedLineTax[] = lines.map((line) => {
    // Pro-rata share. Guarded against a zero-value basket (a 100%-discounted
    // order, or a free item) where there is nothing to apportion against.
    const share = grossSubtotal > 0 ? line.amount / grossSubtotal : 0;
    const net = line.amount - effectiveDiscount * share;
    const factor = 1 + line.taxRate / 100;
    if (taxInclusive) {
      // The price already contains the tax: back it out rather than adding it
      // again on top.
      const taxableAmount = factor === 0 ? net : net / factor;
      return {
        taxClassId: line.taxClassId,
        taxRate: line.taxRate,
        taxableAmount,
        taxAmount: net - taxableAmount,
      };
    }
    return {
      taxClassId: line.taxClassId,
      taxRate: line.taxRate,
      taxableAmount: net,
      taxAmount: net * (line.taxRate / 100),
    };
  });

  const netSubtotal = grossSubtotal - effectiveDiscount;
  const lineTax = computed.reduce((sum, l) => sum + l.taxAmount, 0);

  let deliveryTaxAmount = 0;
  if (taxOnDelivery && deliveryFee > 0 && deliveryTaxRate > 0) {
    const factor = 1 + deliveryTaxRate / 100;
    deliveryTaxAmount = taxInclusive
      ? deliveryFee - deliveryFee / factor
      : deliveryFee * (deliveryTaxRate / 100);
  }

  const taxAmount = lineTax + deliveryTaxAmount;
  // Inclusive: every amount already contains its tax, so the total is just what
  // was charged. Exclusive: the tax is genuinely additional.
  const total = taxInclusive
    ? netSubtotal + deliveryFee
    : netSubtotal + deliveryFee + taxAmount;

  const byRate = new Map<
    number,
    { taxableAmount: number; taxAmount: number }
  >();
  for (const line of computed) {
    const entry = byRate.get(line.taxRate) ?? {
      taxableAmount: 0,
      taxAmount: 0,
    };
    entry.taxableAmount += line.taxableAmount;
    entry.taxAmount += line.taxAmount;
    byRate.set(line.taxRate, entry);
  }
  if (deliveryTaxAmount > 0) {
    const entry = byRate.get(deliveryTaxRate) ?? {
      taxableAmount: 0,
      taxAmount: 0,
    };
    entry.taxableAmount += taxInclusive
      ? deliveryFee - deliveryTaxAmount
      : deliveryFee;
    entry.taxAmount += deliveryTaxAmount;
    byRate.set(deliveryTaxRate, entry);
  }

  return {
    taxAmount,
    total,
    lines: computed,
    deliveryTaxAmount,
    breakdown: [...byRate.entries()]
      .map(([taxRate, v]) => ({ taxRate, ...v }))
      .sort((a, b) => b.taxRate - a.taxRate),
  };
}

export interface ZoneLike {
  name: string;
  isActive: boolean;
  // The zone's map circle, as captured by the admin's zone modal. All three are
  // optional: a zone predating the modal has none, and mysql2 hands a DECIMAL
  // back as a string, so both shapes are accepted and read through `Number()`.
  id?: number;
  // The regions this zone covers (deliveryzoneregion). Read only in 'regions'
  // matching mode; see delivery-zones/zone-matching-mode.ts.
  regionIds?: number[];
  lat?: string | number | null;
  lng?: string | number | null;
  radiusKm?: string | number | null;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

// The admin zone modal's "pin not placed yet" default centre
// (admin/components/DeliveryZoneMap.tsx's UAE_CENTER, mirrored by hand, the two
// apps share no code). A zone saved without the merchant moving the pin still
// carries this centre and a 5km radius; that circle describes nothing the
// merchant chose, so it must never decide a fee. It sits in open desert, so
// today it would simply never match, but a merchant who widens the radius
// without placing the pin would start capturing real addresses.
const UNPLACED_ZONE_CENTER: GeoPoint = { lat: 23.85, lng: 54.4 };

// True when the merchant has actually placed the zone's circle: a real centre and
// radius, not the modal's unplaced default. Such a zone can match by location alone.
export function hasPlacedCircle(zone: ZoneLike): boolean {
  return zoneCircle(zone) !== null;
}

function zoneCircle(
  zone: ZoneLike,
): { center: GeoPoint; radiusKm: number } | null {
  if (zone.lat == null || zone.lng == null || zone.radiusKm == null) {
    return null;
  }
  const lat = Number(zone.lat);
  const lng = Number(zone.lng);
  const radiusKm = Number(zone.radiusKm);
  if (![lat, lng, radiusKm].every(Number.isFinite) || radiusKm <= 0) {
    return null;
  }
  if (lat === UNPLACED_ZONE_CENTER.lat && lng === UNPLACED_ZONE_CENTER.lng) {
    return null;
  }
  return { center: { lat, lng }, radiusKm };
}

// Picks the zone whose map circle contains the customer's pin. When several
// contain it the tightest circle wins (a 2km "Marina" inside a 15km "Dubai
// South"), then the nearest centre, then the lowest id, so the answer never
// depends on row order.
function matchZoneByLocation<Z extends ZoneLike>(
  zones: Z[],
  location: GeoPoint,
): Z | null {
  let best: {
    zone: Z;
    radiusKm: number;
    distanceKm: number;
    id: number;
  } | null = null;
  for (const zone of zones) {
    const circle = zoneCircle(zone);
    if (!circle) continue;
    const distanceKm = haversineDistanceKm(
      location.lat,
      location.lng,
      circle.center.lat,
      circle.center.lng,
    );
    // Inclusive boundary, the same way the outlet radius check rejects only
    // `distance > radius`.
    if (distanceKm > circle.radiusKm) continue;
    const candidate = {
      zone,
      radiusKm: circle.radiusKm,
      distanceKm,
      id: zone.id ?? Number.MAX_SAFE_INTEGER,
    };
    if (
      !best ||
      candidate.radiusKm < best.radiusKm ||
      (candidate.radiusKm === best.radiusKm &&
        (candidate.distanceKm < best.distanceKm ||
          (candidate.distanceKm === best.distanceKm && candidate.id < best.id)))
    ) {
      best = candidate;
    }
  }
  return best?.zone ?? null;
}

// Zones carry a free-text `name` (e.g. "Dubai", "DXB/SHJ/AJM") plus, since the
// admin map modal, an optional circle. Resolution runs from most to least
// specific:
//   1. the customer's area equals a zone name (trimmed, case-insensitive);
//   2. the customer's pin falls inside a zone's circle (SHP-1);
//   3. the customer's emirate equals a zone name.
// Step 2 is what stops "Dubai Marina" (customer text) against a zone named
// "Marina" from silently dropping to the emirate-wide zone: the merchant drew
// where "Marina" is, and the pin says the customer is inside it. With no pin,
// or no zone that has a placed circle, step 2 yields nothing and this is
// exactly the name-only behaviour it had before.
export function matchDeliveryZone<Z extends ZoneLike>(
  zones: Z[],
  area: string | null | undefined,
  emirate: string,
  location?: GeoPoint | null,
): Z | null {
  const active = zones.filter((z) => z.isActive);
  const norm = (s: string) => s.trim().toLowerCase();
  if (area?.trim()) {
    const byArea = active.find((z) => norm(z.name) === norm(area));
    if (byArea) return byArea;
  }
  if (location) {
    const byLocation = matchZoneByLocation(active, location);
    if (byLocation) return byLocation;
  }
  return active.find((z) => norm(z.name) === norm(emirate)) ?? null;
}

// Zone resolution once a shop's zones are region-mapped (see
// delivery-zones/zone-matching-mode.ts). The zone's NAME plays no part:
//   1. the customer's pin inside a placed map circle (tightest circle wins), else
//   2. a zone whose region set contains the customer's region (the zone covering
//      the fewest regions wins, as the most specific; then the lowest id).
// With neither a pin inside a circle nor a region match the answer is null, and
// the caller applies the same "no zone matched" rule as the legacy path.
export function matchDeliveryZoneByRegion<Z extends ZoneLike>(
  zones: Z[],
  regionId: number | null | undefined,
  location?: GeoPoint | null,
): Z | null {
  const active = zones.filter((z) => z.isActive);
  if (location) {
    const byLocation = matchZoneByLocation(active, location);
    if (byLocation) return byLocation;
  }
  if (regionId == null) return null;
  let best: Z | null = null;
  for (const zone of active) {
    const ids = zone.regionIds ?? [];
    if (!ids.includes(regionId)) continue;
    if (
      !best ||
      ids.length < (best.regionIds ?? []).length ||
      (ids.length === (best.regionIds ?? []).length &&
        (zone.id ?? Number.MAX_SAFE_INTEGER) <
          (best.id ?? Number.MAX_SAFE_INTEGER))
    ) {
      best = zone;
    }
  }
  return best;
}
