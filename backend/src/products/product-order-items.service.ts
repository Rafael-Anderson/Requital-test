import {
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { buildVariantLabel } from './variant-generator';
import { resolveUnitCost } from './product-cost';
import { DatabaseService } from '../database/database.service';
import { DiscountsService } from '../discounts/discounts.service';
import { FeaturesService } from '../features/features.service';

// One ingredient an order took out of stock, by the order-line identity the
// record is keyed on (productId + variantId as the line names them, which is
// NOT necessarily the recipe row's own variantId: a variant line can inherit
// the product-level recipe). `quantity` is positive = units taken.
export interface ConsumedRow {
  productId: number;
  variantId: number | null;
  ingredientId: number;
  quantity: number;
}

// Order-time item resolution (price, tax class, variant, auto-discounts) and ingredient consumption/restock for order lifecycle callers.
@Injectable()
export class ProductOrderItemsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly discountsService: DiscountsService,
    private readonly features: FeaturesService,
  ) {}

  // Shared by OrdersService/PublicService order creation — validates that
  // every item references a real product for this shop, that variant-bearing
  // products get a variantId (and non-variant ones don't), and resolves the
  // effective price + a human-readable variantLabel snapshot for each line.
  // Doesn't touch stock — callers pass the resolved items (incl. the
  // allowNegative flag below) into consumeForOrderItems themselves
  // (storefront checkout needs a CAS guard, admin-entered orders defer the
  // decrement to confirmation — see orders.service.ts).
  async resolveOrderItems(
    shopId: number,
    items: {
      productId: number;
      quantity: number;
      variantId?: number;
      priceOverride?: number;
      giftCardAmount?: number;
    }[],
  ) {
    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM product WHERE id IN (${productIds.map(() => '?').join(', ')}) AND shopId = ?`,
      [...productIds, shopId],
    );
    if (products.length !== productIds.length) {
      throw new BadRequestException(
        'One or more items reference a product that does not belong to this shop',
      );
    }
    const optionCountRows = await this.db.query<RowDataPacket[]>(
      `SELECT productId, COUNT(*) AS c FROM productoption WHERE productId IN (${productIds.map(() => '?').join(', ')}) GROUP BY productId`,
      productIds,
    );
    const optionCountByProduct = new Map(
      optionCountRows.map((r) => [r.productId as number, Number(r.c)]),
    );
    const productsById = new Map(products.map((p) => [p.id as number, p]));

    // Auto-apply discounts ("applies automatically to every matching cart,
    // no code needed") must be resolved server-side, never trusted from a
    // client-computed display price — this is the actual source of truth
    // storefront/lib/auto-discounts.ts's computeAutoDiscountedPrice mirrors
    // for display only. One shop-wide fetch (not per item) + one collection
    // lookup, reused by DiscountsService.findBestAutoDiscountAmount below.
    const autoDiscounts =
      await this.discountsService.listActiveAutoDiscounts(shopId);
    const collectionRows = autoDiscounts.length
      ? await this.db.query<RowDataPacket[]>(
          `SELECT productId, collectionId FROM productcollection WHERE productId IN (${productIds.map(() => '?').join(', ')})`,
          productIds,
        )
      : [];
    const collectionIdsByProduct = new Map<number, number[]>();
    for (const row of collectionRows) {
      const pid = row.productId as number;
      const list = collectionIdsByProduct.get(pid) ?? [];
      list.push(row.collectionId as number);
      collectionIdsByProduct.set(pid, list);
    }

    // Tax classes for the per-line tax capture (Phase 2b / B2). ONE shop-wide
    // fetch, the same shape as listActiveAutoDiscounts above - not a query per
    // line. `product.taxClassId` already arrives on the product rows (this
    // method does SELECT * FROM product), so resolving a line's rate needs
    // nothing else.
    const taxClasses = await this.db.query<RowDataPacket[]>(
      `SELECT id, rate, type, isDefault FROM taxclass WHERE shopId = ?`,
      [shopId],
    );
    const taxClassById = new Map(taxClasses.map((t) => [t.id as number, t]));
    // A product with no class of its own resolves through the shop default -
    // NULL means "no class of its own", never "untaxed".
    const defaultTaxClass =
      taxClasses.find((t) => t.isDefault === true) ?? null;

    // Recipes for the cost capture below. One batched query for the whole
    // order, same batch-load-then-assemble shape as the collection lookup
    // above - not one query per line. Only recipe-backed products need it;
    // a plain product's cost is its own column.
    const recipeProductIds = products
      .filter((p) => p.usesIngredients)
      .map((p) => p.id as number);
    const recipeRows = recipeProductIds.length
      ? await this.db.query<RowDataPacket[]>(
          `SELECT pi.productId, pi.variantId, pi.ingredientId, pi.quantityPerUnit,
                  ing.costPerUnit
             FROM productingredient pi
             JOIN ingredient ing ON ing.id = pi.ingredientId
            WHERE pi.productId IN (${recipeProductIds.map(() => '?').join(', ')})`,
          recipeProductIds,
        )
      : [];

    const variantIds = [
      ...new Set(
        items.filter((i) => i.variantId !== undefined).map((i) => i.variantId!),
      ),
    ];
    const variants = variantIds.length
      ? await this.db.query<RowDataPacket[]>(
          `SELECT v.*, ov1.value AS optionValue1Value, ov2.value AS optionValue2Value, ov3.value AS optionValue3Value
           FROM productvariant v
           LEFT JOIN productoptionvalue ov1 ON ov1.id = v.optionValue1Id
           LEFT JOIN productoptionvalue ov2 ON ov2.id = v.optionValue2Id
           LEFT JOIN productoptionvalue ov3 ON ov3.id = v.optionValue3Id
           WHERE v.id IN (${variantIds.map(() => '?').join(', ')})`,
          variantIds,
        )
      : [];
    const variantsById = new Map(variants.map((v) => [v.id as number, v]));

    // Same effective-recipe rule consumeForOrderItems applies when stock is
    // taken: a variant's own rows REPLACE the product-wide ones wholesale
    // when any exist, otherwise the product-wide rows apply. (Taking both
    // double-costed an overridden ingredient, F3.) Read as the recipe stands
    // RIGHT NOW, which is the point - the same ERP discipline priceAtPurchase
    // follows.
    const recipeFor = (productId: number, variantId: number | null) => {
      const rows = recipeRows.filter((r) => r.productId === productId);
      const overrides =
        variantId === null ? [] : rows.filter((r) => r.variantId === variantId);
      return (
        overrides.length > 0 ? overrides : rows.filter((r) => r.variantId === null)
      ).map((r) => ({
        ingredientId: r.ingredientId as number,
        quantityPerUnit: Number(r.quantityPerUnit),
        costPerUnit: r.costPerUnit as string | null,
      }));
    };

    return items.map((item) => {
      const product = productsById.get(item.productId)!;
      const hasVariants = (optionCountByProduct.get(item.productId) ?? 0) > 0;
      let variant: RowDataPacket | null = null;
      if (hasVariants) {
        if (item.variantId === undefined) {
          throw new BadRequestException(
            `${product.name as string} requires selecting an option before ordering`,
          );
        }
        const found = variantsById.get(item.variantId);
        if (!found || found.productId !== product.id) {
          throw new BadRequestException(
            `Invalid variant selected for ${product.name as string}`,
          );
        }
        variant = found;
      } else if (item.variantId !== undefined) {
        throw new BadRequestException(
          `${product.name as string} does not have variant options`,
        );
      }

      // Gift Cards: the product's own `price` is a placeholder — the real
      // amount is whichever denomination/custom value the shopper picked,
      // supplied per-line as giftCardAmount. Unlike priceOverride (below),
      // this IS accepted from the public storefront DTO, but only ever for
      // a product actually flagged isGiftCard, and only ever a value the
      // merchant actually configured (one of giftCardDenominations, or
      // within the custom-amount min/max) — never an arbitrary customer-
      // supplied price the way a bare priceOverride would be.
      let price: string;
      let autoDiscountAmount: string | null = null;
      if (product.isGiftCard) {
        if (item.giftCardAmount === undefined) {
          throw new BadRequestException(
            `${product.name as string} requires choosing a gift card amount`,
          );
        }
        this.assertValidGiftCardAmount(product, item.giftCardAmount);
        price = String(item.giftCardAmount);
      } else if (item.giftCardAmount !== undefined) {
        throw new BadRequestException(
          `${product.name as string} is not a gift card product`,
        );
      } else if (item.priceOverride !== undefined) {
        // Admin-only override (draft orders / manual phone-order price
        // adjustments) — see CreateOrderDto.items.priceOverride. Never
        // exposed on the public/storefront item DTO, so a storefront
        // customer can never set their own price this way. An explicit
        // override always wins over an auto-discount, same as it already
        // wins over the plain catalog price.
        price = String(item.priceOverride);
      } else {
        const basePrice =
          (variant?.price as string | undefined) ?? (product.price as string);
        const discountAmount = autoDiscounts.length
          ? this.discountsService.findBestAutoDiscountAmount(autoDiscounts, {
              productId: item.productId,
              price: Number(basePrice),
              collectionIds: collectionIdsByProduct.get(item.productId) ?? [],
            })
          : 0;
        if (discountAmount > 0) {
          autoDiscountAmount = String(discountAmount);
          price = String(Number(basePrice) - discountAmount);
        } else {
          price = basePrice;
        }
      }

      // What this line cost US, frozen now for exactly the same reason
      // `price` is: reading product.costPrice at report time would report
      // today's cost against a historical sale, and would silently rewrite
      // every past margin figure the moment a merchant edits a cost. An
      // admin priceOverride changes what was charged, not what it cost, so
      // the cost is captured for those lines too.
      const unitCost = resolveUnitCost({
        usesIngredients: !!product.usesIngredients,
        costPrice: product.costPrice as string | null,
        recipe: recipeFor(item.productId, variant?.id ?? null),
      });

      // The class this line is actually taxed under, resolved at order time and
      // frozen by the caller into orderitem.taxClassId/taxRate. A product
      // pointing at nothing falls back to the shop default; a shop with no
      // default at all (every class deleted) resolves to null/0, which is a
      // genuinely unknown rate rather than an invented one.
      const ownClass =
        product.taxClassId != null
          ? (taxClassById.get(product.taxClassId as number) ?? null)
          : null;
      const taxClass = ownClass ?? defaultTaxClass;

      return {
        product,
        variant,
        quantity: item.quantity,
        price,
        autoDiscountAmount,
        unitCost,
        taxClassId: taxClass ? (taxClass.id as number) : null,
        taxRate: taxClass ? Number(taxClass.rate) : 0,
        variantLabel: variant
          ? buildVariantLabel([
              variant.optionValue1Value as string | undefined,
              variant.optionValue2Value as string | undefined,
              variant.optionValue3Value as string | undefined,
            ])
          : null,
        // Threaded into consumeForOrderItems so a product/variant that
        // opted out of stock tracking entirely, or explicitly allows
        // overselling, never blocks (or is blocked by) a stricter sibling
        // item in the same cart — see consumeForOrderItems's own comment on
        // why this has to be per-item, not one flag for the whole call.
        allowNegative: !product.trackInventory || product.continueSellingOutOfStock,
      };
    });
  }

  // Bill of Materials — the actual ingredient-stock side effect of a sale.
  // Called from the exact same points product stock itself is
  // decremented/restocked (never a separate trigger — see each call site):
  // PublicService.createOrder and OrdersService.create's reserveStock path
  // (immediate reservation at creation, direction -1), and
  // OrdersService.adjustStockForOrder (the pending->confirmed decrement for
  // every other channel, direction -1; and every cancel-restock, direction
  // +1). Returns whether anything was actually consumed, so the caller can
  // set order.ingredientsConsumedAt — read back on restock instead of
  // re-deriving it from the toggle, see that column's own schema comment.
  //
  // Toggle gating is intentionally asymmetric by direction: direction -1 is
  // a fresh "should this fire at all" decision (F12: for RECIPE-backed lines
  // only, plain lines always take stock, see plainOnly below), so it re-checks
  // shop.autoDeductIngredientStock itself right here — not just relying on
  // an upstream pre-filter having already checked it, the exact class of
  // bug already caught twice in this codebase (AbandonedCartsService,
  // LowStockDigestService) when a toggle check lived only in the outer
  // caller. direction +1 is never a new policy decision, only ever
  // reversing one specific order's own already-recorded consumption — the
  // caller is responsible for only invoking it when
  // order.ingredientsConsumedAt says that really happened, regardless of
  // what the toggle reads *now*; re-checking the toggle here too would
  // silently skip a restock for an order that genuinely did consume stock
  // under an since-disabled toggle, corrupting the count in the opposite
  // direction.
  async consumeForOrderItems(
    conn: PoolConnection,
    shopId: number,
    outletId: number,
    items: {
      productId: number;
      variantId: number | null;
      quantity: number;
      // Per-item, not one flag for the whole call — a product that opted
      // out of stock tracking (trackInventory: false) or explicitly allows
      // overselling (continueSellingOutOfStock) must never block, and must
      // never BE blocked by, a stricter sibling item in the same
      // cart/order. Defaults false when the caller doesn't resolve it via
      // resolveOrderItems (every restock/return caller — going negative was
      // never possible to guard against on a restock anyway).
      allowNegative?: boolean;
    }[],
    direction: 1 | -1,
    options: {
      throwOnInsufficientStock: boolean;
      actorUserId: number | null;
      // 'CONSUMED' (default) for every order-lifecycle caller; 'RETURN' for
      // ReturnsService so a customer return stays distinguishable from an
      // order cancellation in Movement History, same audit-trail
      // distinction this table already draws between ADJUSTMENT/TRANSFER.
      movementType?: string;
      // Defaults to null (every order-lifecycle caller). ReturnsService
      // passes a real note referencing which return caused the restock —
      // same audit-trail detail its own direct outletstock/outletvariantstock
      // upsert used to carry before Phase A collapsed onto this function.
      note?: string | null;
      // Defaults to null. ReturnsService passes the return's own reason —
      // same field its own inline stockmovement.create already populated
      // for a RETURN row before Phase A (a deliberate, pre-existing
      // deviation from this column's "ADJUSTMENT only" schema comment, not
      // introduced here).
      reason?: string | null;
      // Record what this call took (direction -1 only) in
      // orderstockconsumption, so every later restock or delta is driven by
      // what the order actually consumed instead of today's recipe and
      // flags. `orderId`: the order exists, write the record here, on this
      // connection, in the same transaction as the decrement. `collect`: the
      // order row is not inserted yet (checkout reserves stock first), the
      // caller gets the rows and passes them to recordOrderConsumption once it
      // has the id. Neither: no record (LEGACY orders, which keep the old
      // recipe-driven restock).
      orderId?: number;
      collect?: ConsumedRow[];
      // direction -1 only: the order has NO consumption record (LEGACY, it
      // predates migration 20261010100000). Such an order keeps the old rule
      // exactly: toggle off takes nothing, plain products included.
      legacyOrder?: boolean;
    },
  ): Promise<boolean> {
    if (direction === 1 && (options.orderId !== undefined || options.collect))
      throw new Error(
        'consumeForOrderItems: recording is for direction -1 only; restocks go through releaseOrderConsumption',
      );
    const recorded: ConsumedRow[] = [];
    // F12: the toggle governs RECIPE-BACKED lines only. With it off, a plain
    // line still decrements; a recipe line is skipped. A line is PLAIN when
    // every row of its effective recipe (variant override rows, else the
    // product-level rows) points at a shadow ingredient, the auto-created
    // quantityPerUnit = 1 stand-in a product gets for its own stock. Any real
    // ingredient in the effective recipe makes the line recipe-backed, so a
    // variant with its own real recipe on an otherwise plain product counts as
    // recipe-backed. trackInventory / continueSellingOutOfStock skips are
    // untouched (the shadow's trackInventory mirrors the product's).
    let plainOnly = false;
    if (direction === -1) {
      // Read on the caller's own connection: this runs inside the order's
      // transaction and must not take a second pool connection.
      if (!(await this.features.isEnabled(shopId, 'auto_deduct_ingredient_stock', conn))) {
        if (options.legacyOrder) return false;
        plainOnly = true;
      }
    }

    const productIds = [...new Set(items.map((i) => i.productId))];
    if (productIds.length === 0) return false;
    const [recipeRows] = await conn.query<RowDataPacket[]>(
      `SELECT pi.id, pi.productId, pi.variantId, pi.ingredientId, pi.quantityPerUnit,
              ing.name AS ingredientName, ing.trackInventory AS ingredientTrackInventory,
              ing.shadowProductId AS ingredientShadowProductId, ing.shadowVariantId AS ingredientShadowVariantId
       FROM productingredient pi
       JOIN ingredient ing ON ing.id = pi.ingredientId
       WHERE pi.productId IN (${productIds.map(() => '?').join(', ')})`,
      productIds,
    );
    if (recipeRows.length === 0) return false;

    const rowsByProduct = new Map<number, RowDataPacket[]>();
    for (const row of recipeRows) {
      const pid = row.productId as number;
      if (!rowsByProduct.has(pid)) rowsByProduct.set(pid, []);
      rowsByProduct.get(pid)!.push(row);
    }
    const movementType = options.movementType ?? 'CONSUMED';

    let consumedAnything = false;
    for (const item of items) {
      const rowsForProduct = rowsByProduct.get(item.productId);
      if (!rowsForProduct) continue;
      // Same effective-recipe rule as resolveEffectiveRecipeRows below, just
      // inlined — that generic doesn't structurally accept RowDataPacket's
      // index-signature shape as satisfying its `{variantId}` constraint.
      const variantOverrides =
        item.variantId !== null
          ? rowsForProduct.filter((r) => r.variantId === item.variantId)
          : [];
      const effectiveRows =
        variantOverrides.length > 0
          ? variantOverrides
          : rowsForProduct.filter((r) => r.variantId === null);
      if (
        plainOnly &&
        !effectiveRows.every(
          (r) =>
            r.ingredientShadowProductId !== null ||
            r.ingredientShadowVariantId !== null,
        )
      )
        continue;
      for (const row of effectiveRows) {
        if (!Boolean(row.ingredientTrackInventory)) continue;
        const totalQty = (row.quantityPerUnit as number) * item.quantity;
        const delta = direction * totalQty;
        consumedAnything = true;

        if (
          direction === -1 &&
          options.throwOnInsufficientStock &&
          !item.allowNegative
        ) {
          const result = await conn.query(
            `UPDATE outletingredientstock SET stockQuantity = stockQuantity - ?
             WHERE outletId = ? AND ingredientId = ? AND stockQuantity >= ?`,
            [totalQty, outletId, row.ingredientId, totalQty],
          );
          if ((result[0] as { affectedRows: number }).affectedRows === 0) {
            throw new ConflictException(
              `Not enough ${row.ingredientName as string} in stock to fulfill this order`,
            );
          }
        } else {
          // Matches product stock's own adjustStockForOrder behavior at
          // this exact point (the confirm-transition decrement and every
          // restock): an atomic increment, no floor guard — deliberately
          // not stricter for ingredients than the codebase already is for
          // product stock at this same trigger point.
          await conn.query(
            `INSERT INTO outletingredientstock (outletId, ingredientId, stockQuantity)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE stockQuantity = stockQuantity + VALUES(stockQuantity)`,
            [outletId, row.ingredientId, delta],
          );
        }

        // Shadow-resolved (Phase A): set productId/variantId alongside
        // ingredientId so Movement History's existing productId filter
        // keeps working for a usesIngredients:false product/variant — see
        // stockmovement's own schema comment on this exception. A REAL
        // ingredient consumed by a multi-ingredient recipe keeps the
        // original ingredientId-only shape.
        const isShadow =
          row.ingredientShadowProductId !== null ||
          row.ingredientShadowVariantId !== null;
        await this.insertConsumptionMovement(conn, {
          shopId,
          outletId,
          ingredientId: row.ingredientId as number,
          productId: isShadow ? item.productId : null,
          variantId: isShadow ? (row.variantId as number | null) : null,
          type: movementType,
          reason: options.reason ?? null,
          delta,
          note: options.note ?? null,
          actorUserId: options.actorUserId,
        });
        if (direction === -1)
          recorded.push({
            productId: item.productId,
            variantId: item.variantId,
            ingredientId: row.ingredientId as number,
            quantity: totalQty,
          });
      }
    }
    if (options.orderId !== undefined)
      await this.recordOrderConsumption(conn, shopId, options.orderId, recorded);
    options.collect?.push(...recorded);
    return consumedAnything;
  }

  private async insertConsumptionMovement(
    conn: PoolConnection,
    m: {
      shopId: number;
      outletId: number;
      ingredientId: number;
      productId: number | null;
      variantId: number | null;
      type: string;
      reason: string | null;
      delta: number;
      note: string | null;
      actorUserId: number | null;
    },
  ) {
    await conn.query(
      `INSERT INTO stockmovement (shopId, productId, variantId, ingredientId, type, reason, delta, outletId, toOutletId, note, actorUserId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        m.shopId,
        m.productId,
        m.variantId,
        m.ingredientId,
        m.type,
        m.reason,
        m.delta,
        m.outletId,
        null,
        m.note,
        m.actorUserId,
      ],
    );
  }

  // Adds `rows` to what the order holds (orderstockconsumption). Same
  // connection as the decrement it describes, so the two commit or roll back
  // together; the shop scope is on the row itself. A row for the same line and
  // ingredient accumulates (an edit that raises a quantity, a confirm after
  // nothing). Callers only invoke it for an order that carries
  // consumptionRecordedAt: a LEGACY order must never get a partial record, or
  // its restock would silently stop at the delta.
  async recordOrderConsumption(
    conn: PoolConnection,
    shopId: number,
    orderId: number,
    rows: ConsumedRow[],
  ) {
    for (const r of rows) {
      await conn.query(
        `INSERT INTO orderstockconsumption (shopId, orderId, productId, variantId, ingredientId, quantity)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
        [shopId, orderId, r.productId, r.variantId, r.ingredientId, r.quantity],
      );
    }
  }

  // The restock side of the record: gives back to stock what the order
  // actually holds, NOT what today's recipe says it should have taken (F10),
  // regardless of product.trackInventory (F11) or the toggle (F2, F9): if the
  // order consumed nothing there are no rows and nothing is returned.
  //
  // `only` limits it to some lines and a fraction of each: `num` of `den`
  // units, so returning 1 of 3 units of a line gives back a third of what that
  // line holds (exact when the per-unit take was uniform, which is every order
  // whose recipe was not edited mid-flight; otherwise the average per unit,
  // rounded DOWN so a restock never exceeds what was held). num >= den gives
  // back the whole line. Without `only`, everything the order holds (cancel).
  //
  // Every row is read FOR UPDATE and zeroed in place; the stock increment and
  // its stockmovement row are written on the same connection, so the
  // conservation invariant (sum of movements == stock) holds exactly as it does
  // for a consume. Returns what was actually given back.
  async releaseOrderConsumption(
    conn: PoolConnection,
    p: {
      shopId: number;
      outletId: number;
      orderId: number;
      actorUserId: number | null;
      movementType: string;
      note?: string | null;
      reason?: string | null;
      only?: {
        productId: number;
        variantId: number | null;
        num: number;
        den: number;
      }[];
    },
  ): Promise<ConsumedRow[]> {
    const [held] = await conn.query<RowDataPacket[]>(
      `SELECT id, productId, variantId, ingredientId, quantity
         FROM orderstockconsumption
        WHERE orderId = ? AND shopId = ? AND quantity > 0
        ORDER BY id FOR UPDATE`,
      [p.orderId, p.shopId],
    );
    const released: ConsumedRow[] = [];
    if (held.length === 0) return released;
    // Same rule as every other stock write that takes an outletId: it must
    // belong to the shop before stock is written to it.
    const [outletRows] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM outlet WHERE id = ? AND shopId = ?`,
      [p.outletId, p.shopId],
    );
    if (outletRows.length === 0)
      throw new BadRequestException('Outlet not found for this shop');
    const [ingRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, shadowProductId, shadowVariantId FROM ingredient
        WHERE shopId = ? AND id IN (${[...new Set(held.map((h) => h.ingredientId as number))].map(() => '?').join(', ')})`,
      [p.shopId, ...new Set(held.map((h) => h.ingredientId as number))],
    );
    const ingById = new Map(ingRows.map((i) => [i.id as number, i]));
    for (const h of held) {
      let amount = h.quantity as number;
      if (p.only) {
        const sel = p.only.find(
          (o) =>
            o.productId === h.productId &&
            (o.variantId ?? null) === (h.variantId ?? null),
        );
        if (!sel) continue;
        if (sel.num < sel.den)
          amount = Math.floor(((h.quantity as number) * sel.num) / sel.den);
      }
      if (amount <= 0) continue;
      await conn.query(
        `UPDATE orderstockconsumption SET quantity = quantity - ? WHERE id = ?`,
        [amount, h.id],
      );
      await conn.query(
        `INSERT INTO outletingredientstock (outletId, ingredientId, stockQuantity)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE stockQuantity = stockQuantity + VALUES(stockQuantity)`,
        [p.outletId, h.ingredientId, amount],
      );
      // A shadow ingredient keeps its product/variant on the movement row so
      // Movement History's productId filter still finds it (same rule as
      // consumeForOrderItems).
      const ing = ingById.get(h.ingredientId as number);
      const isShadow =
        !!ing &&
        (ing.shadowProductId !== null || ing.shadowVariantId !== null);
      await this.insertConsumptionMovement(conn, {
        shopId: p.shopId,
        outletId: p.outletId,
        ingredientId: h.ingredientId as number,
        productId: isShadow ? (h.productId as number) : null,
        variantId: isShadow ? ((ing!.shadowVariantId as number | null) ?? null) : null,
        type: p.movementType,
        reason: p.reason ?? null,
        delta: amount,
        note: p.note ?? null,
        actorUserId: p.actorUserId,
      });
      released.push({
        productId: h.productId as number,
        variantId: h.variantId as number | null,
        ingredientId: h.ingredientId as number,
        quantity: amount,
      });
    }
    return released;
  }

  // A variant's own override rows take over its recipe wholesale when any
  // exist; otherwise it inherits the product-level default (variantId:
  // null) rows — same rule as toVariantResponse's own effective-recipe
  // resolution, just operating on plain rows instead of API response shapes.
  private resolveEffectiveRecipeRows<T extends { variantId: number | null }>(
    rows: T[],
    variantId: number | null,
  ): T[] {
    if (variantId !== null) {
      const overrides = rows.filter((r) => r.variantId === variantId);
      if (overrides.length > 0) return overrides;
    }
    return rows.filter((r) => r.variantId === null);
  }

  private assertValidGiftCardAmount(
    product: RowDataPacket,
    amount: number,
  ) {
    if (amount <= 0) {
      throw new BadRequestException(
        'Gift card amount must be greater than zero',
      );
    }
    const denominationsRaw = product.giftCardDenominations as unknown;
    const denominations = Array.isArray(denominationsRaw)
      ? (denominationsRaw as number[])
      : [];
    if (denominations.includes(amount)) return;
    const min = product.giftCardCustomAmountMin as string | null;
    const max = product.giftCardCustomAmountMax as string | null;
    if (min !== null && max !== null) {
      if (amount >= Number(min) && amount <= Number(max)) return;
    }
    throw new BadRequestException(
      `${amount} is not a valid gift card amount for ${product.name as string}`,
    );
  }
}
