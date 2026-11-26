import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { isDuplicateKeyError } from '../database/mysql-errors';
import { ProductsService } from '../products/products.service';
import { PublicService } from '../public/public.service';
import { RegionsService } from '../regions/regions.service';
import { computeOrderTotals } from '../public/order-pricing';
import { roundMoney, toMinorUnits } from '../common/currency-minor-units';
import {
  assertOrderWithinLimits,
  type OrderSize,
} from '../common/order-limits';
import type { DraftOrderItemInput } from './dto/draft-order-item.dto';

// What a builder line resolves to before pricing.
export interface NormalisedLine {
  productId: number;
  variantId?: number;
  quantity: number;
  // Sent to resolveOrderItems as priceOverride: a custom item's price, or a
  // catalogue price staff overrode (with a reason). Undefined = live price.
  priceOverride?: number;
  priceReason: string | null;
  customName: string | null;
  taxable: boolean | null;
}

export interface BillLine {
  productId: number;
  variantId: number | null;
  name: string;
  variantLabel: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  taxRate: number | null;
  custom: boolean;
  priceOverridden: boolean;
  priceReason: string | null;
}

export interface Bill {
  currency: string;
  taxInclusive: boolean;
  lines: BillLine[];
  subtotal: string;
  discount: {
    amount: string;
    source: 'code' | 'manual' | null;
    code: string | null;
    reason: string | null;
  };
  // NULL = the fee cannot be priced yet (deliveryError says why).
  deliveryFee: string | null;
  deliveryFeeSource: 'zone' | 'override' | 'pickup' | null;
  deliveryZone: string | null;
  deliveryError: string | null;
  taxAmount: string | null;
  total: string | null;
  stockWarnings: {
    productId: number;
    variantId: number | null;
    name: string;
    requested: number;
    available: number;
  }[];
}

export interface PricingInput {
  outletId: number;
  orderType?: string | null;
  regionId?: number | null;
  area?: string | null;
  customerAddress?: string | null;
  items: NormalisedLine[];
  discountCode?: string | null;
  orderDiscountType?: string | null;
  orderDiscountValue?: number | null;
  orderDiscountReason?: string | null;
  deliveryFeeOverride?: number | null;
  // An existing draft's stored size: one saved before the order limits can
  // still be priced (and edited down) as it stands.
  sizeBaseline?: OrderSize;
}

// A staff discount as an amount on these lines: a percent of the goods, or a
// fixed figure, never more than the goods, rounded once to the currency.
export function manualDiscountAmount(
  type: string | null | undefined,
  value: number | null | undefined,
  goodsSubtotal: number,
  currency: string,
): number {
  if (!type || value == null) return 0;
  const raw =
    type === 'percent' ? (goodsSubtotal * Math.min(value, 100)) / 100 : value;
  return roundMoney(Math.max(0, Math.min(raw, goodsSubtotal)), currency);
}

// Prices a custom order. The delivery fee, discount-code amount and per-line
// tax come from PublicService.priceCheckout (via priceForStaff), the exact
// function a storefront checkout is charged by; overrides and the staff
// discount are then fed through the same computeOrderTotals. The conversion
// passes these same figures to OrdersService.create, which runs
// computeOrderTotals again, so preview, snapshot and order cannot differ.
@Injectable()
export class DraftPricingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly productsService: ProductsService,
    private readonly publicService: PublicService,
    private readonly regionsService: RegionsService,
  ) {}

  // Builder lines to resolver lines. Catalogue lines must name a product; a
  // manual catalogue price needs a reason; a custom line needs a name and a price
  // and points at the shop's system carrier product.
  async normaliseItems(
    shopId: number,
    items: DraftOrderItemInput[],
  ): Promise<NormalisedLine[]> {
    const out: NormalisedLine[] = [];
    for (const [index, item] of items.entries()) {
      const n = index + 1;
      const customName = item.customName?.trim();
      if (customName) {
        if (item.productId !== undefined || item.variantId !== undefined) {
          throw new BadRequestException(
            `Line ${n}: a custom item cannot also name a product`,
          );
        }
        if (item.price === undefined) {
          throw new BadRequestException(
            `Line ${n}: a custom item needs a price`,
          );
        }
        const taxable = item.taxable !== false;
        out.push({
          productId: await this.ensureCarrier(shopId, taxable),
          quantity: item.quantity,
          priceOverride: item.price,
          priceReason: null,
          customName,
          taxable,
        });
        continue;
      }
      if (item.customName !== undefined) {
        throw new BadRequestException(`Line ${n}: a custom item needs a name`);
      }
      if (item.productId === undefined) {
        throw new BadRequestException(`Line ${n}: choose a product`);
      }
      if (item.taxable !== undefined) {
        throw new BadRequestException(
          `Line ${n}: only a custom item has a tax toggle`,
        );
      }
      const reason = item.priceReason?.trim() || null;
      if (item.price !== undefined && !reason) {
        throw new BadRequestException(
          `Line ${n}: give a reason for the changed price`,
        );
      }
      out.push({
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        priceOverride: item.price,
        priceReason: item.price !== undefined ? reason : null,
        customName: null,
        taxable: null,
      });
    }
    return out;
  }

  async price(
    shopId: number,
    input: PricingInput,
    staffKey: string,
  ): Promise<Bill> {
    if (input.discountCode && input.orderDiscountType) {
      throw new BadRequestException(
        'Use either a discount code or a manual discount, not both',
      );
    }
    if (input.orderDiscountType && !input.orderDiscountReason?.trim()) {
      throw new BadRequestException('Give a reason for the discount');
    }
    if (
      input.orderDiscountType === 'percent' &&
      (input.orderDiscountValue ?? 0) > 100
    ) {
      throw new BadRequestException(
        'A percent discount cannot be more than 100',
      );
    }
    const shopRows = await this.db.query<RowDataPacket[]>(
      `SELECT currency, taxInclusive, taxOnDelivery, taxRate FROM shop WHERE id = ?`,
      [shopId],
    );
    const shop = shopRows[0];
    const currency = (shop?.currency as string | undefined) ?? 'AED';
    const resolved = input.items.length
      ? await this.productsService.resolveOrderItems(
          shopId,
          input.items.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            quantity: i.quantity,
            priceOverride: i.priceOverride,
          })),
        )
      : [];
    assertOrderWithinLimits(resolved, input.sizeBaseline);

    const pickup = input.orderType === 'pickup';
    const region = pickup
      ? { regionId: null, regionName: null }
      : await this.regionsService.resolveForShop(
          shopId,
          { regionId: input.regionId ?? undefined },
          { required: false },
        );

    // The storefront pricing. With an override, or for pickup, the zone is not
    // asked (orderType pickup = fee 0, no zone check); the code discount still is.
    let deliveryError: string | null = null;
    let base: Awaited<ReturnType<PublicService['priceForStaff']>> | null = null;
    const askZone = !pickup && input.deliveryFeeOverride == null;
    if (askZone && region.regionId == null) {
      // Only where the shop's country HAS regions to choose from (the rule
      // RegionsService applies everywhere): there, delivery needs one.
      try {
        await this.regionsService.resolveForShop(
          shopId,
          {},
          { required: true },
        );
      } catch {
        deliveryError = 'Choose a region to price delivery';
      }
    }
    const priceWith = (orderType: string) =>
      this.publicService.priceForStaff(
        shopId,
        input.outletId,
        {
          orderType,
          regionId: region.regionId,
          regionName: region.regionName,
          area: input.area ?? undefined,
          discountCode: input.discountCode ?? undefined,
          customerAddress: input.customerAddress ?? undefined,
        },
        resolved,
        staffKey,
      );
    if (resolved.length) {
      if (askZone && !deliveryError) {
        try {
          base = await priceWith('delivery');
        } catch (err) {
          // A delivery rejection (radius, no zone, minimum order) is shown, not
          // thrown: the builder still shows the lines. A discount-code rejection
          // is the caller's to see.
          if (
            err instanceof HttpException &&
            /discount|code/i.test(err.message)
          )
            throw err;
          deliveryError =
            err instanceof HttpException
              ? err.message
              : 'Delivery could not be priced';
        }
      }
      if (!base) base = await priceWith('pickup');
    }

    const lines = resolved.map((r, i) => {
      const meta = input.items[i];
      return {
        productId: r.product.id as number,
        variantId: (r.variant?.id as number | undefined) ?? null,
        name: meta.customName ?? (r.product.name as string),
        variantLabel: r.variantLabel ?? null,
        quantity: r.quantity,
        amount: Number(r.price) * r.quantity,
        unitPrice: r.price,
        taxRate: r.taxRate,
        taxClassId: r.taxClassId,
        custom: meta.customName !== null,
        priceOverridden:
          meta.customName === null && meta.priceOverride !== undefined,
        priceReason: meta.priceReason,
      };
    });
    const goods = lines.reduce((s, l) => s + l.amount, 0);

    let discountAmount = 0;
    let discountSource: 'code' | 'manual' | null = null;
    if (input.orderDiscountType) {
      discountAmount = manualDiscountAmount(
        input.orderDiscountType,
        input.orderDiscountValue,
        goods,
        currency,
      );
      discountSource = 'manual';
    } else if (base?.discount) {
      discountAmount = base.discountAmount;
      discountSource = 'code';
    }

    let deliveryFee: number | null;
    let deliveryFeeSource: Bill['deliveryFeeSource'];
    if (pickup) {
      deliveryFee = 0;
      deliveryFeeSource = 'pickup';
    } else if (input.deliveryFeeOverride != null) {
      deliveryFee = input.deliveryFeeOverride;
      deliveryFeeSource = 'override';
    } else if (deliveryError || !base) {
      deliveryFee = null;
      deliveryFeeSource = null;
    } else {
      // base.deliveryFee is already 0 when a free-shipping code applies.
      deliveryFee = base.deliveryFee;
      deliveryFeeSource = 'zone';
    }

    const totals = computeOrderTotals({
      lines: lines.map((l) => ({
        amount: l.amount,
        taxRate: l.taxRate,
        taxClassId: l.taxClassId,
      })),
      deliveryFee: deliveryFee ?? 0,
      discountAmount,
      taxInclusive: Boolean(shop?.taxInclusive),
      taxOnDelivery: Boolean(shop?.taxOnDelivery),
      deliveryTaxRate: Number(shop?.taxRate ?? 0),
    });
    const priced = deliveryFee !== null;
    const money = (n: number) => String(roundMoney(n, currency));
    return {
      currency,
      taxInclusive: Boolean(shop?.taxInclusive),
      lines: lines.map((l) => ({
        productId: l.productId,
        variantId: l.variantId,
        name: l.name,
        variantLabel: l.variantLabel,
        quantity: l.quantity,
        unitPrice: money(Number(l.unitPrice)),
        lineTotal: money(l.amount),
        taxRate: l.taxRate,
        custom: l.custom,
        priceOverridden: l.priceOverridden,
        priceReason: l.priceReason,
      })),
      subtotal: money(goods),
      discount: {
        amount: money(discountAmount),
        source: discountSource,
        code:
          discountSource === 'code'
            ? (base?.discountCodeSnapshot ?? null)
            : null,
        reason:
          discountSource === 'manual'
            ? (input.orderDiscountReason?.trim() ?? null)
            : null,
      },
      deliveryFee: priced ? money(deliveryFee as number) : null,
      deliveryFeeSource,
      deliveryZone:
        deliveryFeeSource === 'zone' ? (base?.zoneName ?? null) : null,
      deliveryError:
        pickup || input.deliveryFeeOverride != null ? null : deliveryError,
      taxAmount: priced ? money(totals.taxAmount) : null,
      total: priced
        ? money(Math.max(0, roundMoney(totals.total, currency)))
        : null,
      stockWarnings: await this.stockWarnings(
        shopId,
        input.outletId,
        input.items,
        lines,
      ),
    };
  }

  // Lines asking for more than the outlet holds. A warning only: nothing is
  // reserved until the draft converts (v1).
  private async stockWarnings(
    shopId: number,
    outletId: number,
    items: NormalisedLine[],
    lines: {
      productId: number;
      variantId: number | null;
      name: string;
      quantity: number;
    }[],
  ): Promise<Bill['stockWarnings']> {
    const catalogue = lines.filter((_, i) => items[i].customName === null);
    if (!catalogue.length) return [];
    const productIds = [...new Set(catalogue.map((l) => l.productId))];
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT ing.shadowProductId AS productId, ing.shadowVariantId AS variantId,
              COALESCE(s.stockQuantity, 0) AS stock
         FROM ingredient ing
         LEFT JOIN outletingredientstock s ON s.ingredientId = ing.id AND s.outletId = ?
         JOIN product p ON p.id = ing.shadowProductId
        WHERE ing.shopId = ? AND ing.trackInventory = 1 AND p.trackInventory = 1
          AND p.continueSellingOutOfStock = 0
          AND ing.shadowProductId IN (${productIds.map(() => '?').join(', ')})`,
      [outletId, shopId, ...productIds],
    );
    const stockOf = (productId: number, variantId: number | null) =>
      rows.find(
        (r) =>
          r.productId === productId &&
          ((r.variantId as number | null) ?? null) === variantId,
      );
    const requested = new Map<
      string,
      { line: (typeof catalogue)[number]; qty: number }
    >();
    for (const l of catalogue) {
      const key = `${l.productId}:${l.variantId ?? ''}`;
      const entry = requested.get(key) ?? { line: l, qty: 0 };
      entry.qty += l.quantity;
      requested.set(key, entry);
    }
    const warnings: Bill['stockWarnings'] = [];
    for (const { line, qty } of requested.values()) {
      const row = stockOf(line.productId, line.variantId);
      if (!row) continue;
      const available = Number(row.stock);
      if (qty > available) {
        warnings.push({
          productId: line.productId,
          variantId: line.variantId,
          name: line.name,
          requested: qty,
          available,
        });
      }
    }
    return warnings;
  }

  // The shop's system carrier for custom items (one taxable, one not), created
  // on first use. Never Available (so never on the storefront), never tracked in
  // inventory, hidden from admin product lists.
  async ensureCarrier(shopId: number, taxable: boolean): Promise<number> {
    const role = taxable ? 'custom_item' : 'custom_item_untaxed';
    const find = async () => {
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT id FROM product WHERE shopId = ? AND systemRole = ? ORDER BY id LIMIT 1`,
        [shopId, role],
      );
      return rows[0]?.id as number | undefined;
    };
    const existing = await find();
    if (existing) return existing;
    let taxClassId: number | null = null;
    if (!taxable) {
      const classes = await this.db.query<RowDataPacket[]>(
        `SELECT id FROM taxclass WHERE shopId = ? AND rate = 0
          ORDER BY FIELD(type, 'out_of_scope', 'exempt', 'zero'), id LIMIT 1`,
        [shopId],
      );
      if (!classes[0]) {
        throw new BadRequestException(
          'Add a 0% tax class (Settings > Tax classes) to sell a custom item without tax',
        );
      }
      taxClassId = classes[0].id as number;
    }
    const slug = `__${role.replace(/_/g, '-')}`;
    try {
      await this.db.execute(
        `INSERT INTO product (shopId, name, price, thumbnail, sku, slug, status, trackInventory, taxClassId, systemRole)
         VALUES (?, ?, 0, '', ?, ?, 'Unavailable', 0, ?, ?)`,
        [
          shopId,
          taxable ? 'Custom item' : 'Custom item (no tax)',
          slug,
          slug,
          taxClassId,
          role,
        ],
      );
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
    }
    const id = await find();
    if (!id)
      throw new BadRequestException(
        'Custom items are not available for this shop',
      );
    return id;
  }
}

// Equal to the minor unit, in the bill's own currency.
export function sameMoney(
  a: string | number,
  b: string | number,
  currency: string,
): boolean {
  return (
    toMinorUnits(Number(a), currency) === toMinorUnits(Number(b), currency)
  );
}
