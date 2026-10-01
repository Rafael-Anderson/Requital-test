import { Injectable } from '@nestjs/common';
import { type QueryParam, DatabaseService } from '../database/database.service';
import { trimDecimal } from '../database/decimal.util';
import type { RowDataPacket } from 'mysql2/promise';
import { buildVariantLabel } from './variant-generator';

export interface BrandLiteRow extends RowDataPacket {
  id: number;
  name: string;
  logoUrl: string | null;
}

export interface IngredientLinkRow extends RowDataPacket {
  id: number;
  productId: number;
  variantId: number | null;
  ingredientId: number;
  quantityPerUnit: number;
  ingredientName: string;
  ingredientUnit: string;
  ingredientTrackInventory: boolean;
  stockQuantity: number | null;
  lowStockThreshold: number | null;
}

export interface VariantRow extends RowDataPacket {
  id: number;
  productId: number;
  sku: string | null;
  barcode: string | null;
  price: string | null;
  compareAtPrice: string | null;
  weight: string | null;
  imageId: number | null;
  imageUrl: string | null;
  order: number;
  optionValue1Id: number | null;
  optionValue1Value: string | null;
  optionValue2Id: number | null;
  optionValue2Value: string | null;
  optionValue3Id: number | null;
  optionValue3Value: string | null;
  createdAt: Date;
}

export interface AssembledIngredientLink {
  id: number;
  productId: number;
  variantId: number | null;
  ingredientId: number;
  quantityPerUnit: number;
  ingredient: {
    name: string;
    unit: string;
    trackInventory: boolean;
    outletingredientstock?: { stockQuantity: number; lowStockThreshold: number | null }[];
  };
}

export interface AssembledVariant {
  id: number;
  sku: string | null;
  barcode: string | null;
  price: string | null;
  compareAtPrice: string | null;
  weight: string | null;
  imageId: number | null;
  image: { url: string } | null;
  order: number;
  optionValue1Id: number | null;
  optionValue1: { value: string } | null;
  optionValue2Id: number | null;
  optionValue2: { value: string } | null;
  optionValue3Id: number | null;
  optionValue3: { value: string } | null;
  productingredient: AssembledIngredientLink[];
}

export interface AssembledProduct {
  [key: string]: unknown;
  id: number;
  shopId: number;
  name: string;
  price: string;
  compareAtPrice: string | null;
  thumbnail: string;
  sku: string;
  status: string;
  usesIngredients: boolean;
  brandId: number | null;
  brand: { id: number; name: string; logoUrl: string | null } | null;
  taxClassId: number | null;
  productcollection: { collection: RowDataPacket }[];
  producttag: { tag: { name: string } }[];
  productimage: { id: number; url: string; order: number }[];
  productattribute: { id: number; name: string; value: string; order: number }[];
  productfaq: { id: number; question: string; answer: string; order: number }[];
  productoption: {
    id: number;
    name: string;
    order: number;
    productoptionvalue: { id: number; value: string; order: number }[];
  }[];
  productvariant: AssembledVariant[];
  productingredient: AssembledIngredientLink[];
}

export interface UnitsSoldRow extends RowDataPacket {
  productId: number;
  unitsSold: string | null;
}

// Read model for products: batch-loads a product (or a list) with every child relation and shapes the admin API response. Leaf service (database only) shared by the catalog service.
@Injectable()
export class ProductReadService {
  constructor(
    private readonly db: DatabaseService,
  ) {}

  async getUnitsSoldByProduct(shopId: number, productIds: number[]) {
    if (productIds.length === 0) return new Map<number, number>();
    const rows = await this.db.query<UnitsSoldRow[]>(
      `SELECT oi.productId AS productId, SUM(oi.quantity) AS unitsSold
       FROM orderitem oi
       JOIN \`order\` o ON o.id = oi.orderId
       WHERE o.shopId = ? AND o.status != 'cancelled'
         AND oi.productId IN (${productIds.map(() => '?').join(', ')})
       GROUP BY oi.productId`,
      [shopId, ...productIds],
    );
    return new Map(rows.map((r) => [r.productId, Number(r.unitsSold ?? 0)]));
  }

  // Batch-loads every relation productInclude used to fetch in one Prisma
  // nested include, as separate WHERE...IN queries grouped in JS — see
  // loadVariantsWithRelations/loadIngredientLinks below for the two
  // sub-loaders this composes. Returns a Map so callers (findAll/findOne/
  // update/duplicate) can look up by id without re-querying.
  async loadProductsWithRelations(
    productIds: number[],
    outletId: number | undefined,
  ): Promise<Map<number, AssembledProduct>> {
    const result = new Map<number, AssembledProduct>();
    if (productIds.length === 0) return result;
    const idList = productIds.map(() => '?').join(', ');

    const [
      products,
      collectionLinks,
      tagLinks,
      images,
      attributes,
      faqs,
      options,
      variants,
      productIngredients,
    ] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        // DATE_FORMAT alias shadows the raw `newUntil` from `*` (mysql2
        // keeps the last same-named column), so it arrives as a
        // 'YYYY-MM-DD' string the editor's <input type="date"> binds
        // directly — never a timezone-ambiguous Date.
        `SELECT *, DATE_FORMAT(newUntil, '%Y-%m-%d') AS newUntil FROM product WHERE id IN (${idList})`,
        productIds,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT pc.productId, c.* FROM productcollection pc JOIN collection c ON c.id = pc.collectionId WHERE pc.productId IN (${idList})`,
        productIds,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT pt.productId, t.name AS tagName FROM producttag pt JOIN tag t ON t.id = pt.tagId WHERE pt.productId IN (${idList})`,
        productIds,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT * FROM productimage WHERE productId IN (${idList}) ORDER BY \`order\` ASC`,
        productIds,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT * FROM productattribute WHERE productId IN (${idList}) ORDER BY \`order\` ASC`,
        productIds,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT * FROM productfaq WHERE productId IN (${idList}) ORDER BY \`order\` ASC`,
        productIds,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT po.*, pov.id AS valueId, pov.value AS valueValue, pov.order AS valueOrder
         FROM productoption po
         LEFT JOIN productoptionvalue pov ON pov.optionId = po.id
         WHERE po.productId IN (${idList})
         ORDER BY po.\`order\` ASC, pov.\`order\` ASC`,
        productIds,
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT id, productId FROM productvariant WHERE productId IN (${idList}) ORDER BY \`order\` ASC`,
        productIds,
      ),
      this.loadIngredientLinks(
        `productId IN (${idList}) AND variantId IS NULL`,
        productIds,
        outletId,
      ),
    ]);

    const collectionsByProduct = new Map<number, { collection: RowDataPacket }[]>();
    for (const row of collectionLinks) {
      const list = collectionsByProduct.get(row.productId as number) ?? [];
      list.push({ collection: row });
      collectionsByProduct.set(row.productId as number, list);
    }
    const tagsByProduct = new Map<number, { tag: { name: string } }[]>();
    for (const row of tagLinks) {
      const list = tagsByProduct.get(row.productId as number) ?? [];
      list.push({ tag: { name: row.tagName as string } });
      tagsByProduct.set(row.productId as number, list);
    }
    const imagesByProduct = new Map<number, RowDataPacket[]>();
    for (const row of images) {
      const list = imagesByProduct.get(row.productId as number) ?? [];
      list.push(row);
      imagesByProduct.set(row.productId as number, list);
    }
    const attributesByProduct = new Map<number, RowDataPacket[]>();
    for (const row of attributes) {
      const list = attributesByProduct.get(row.productId as number) ?? [];
      list.push(row);
      attributesByProduct.set(row.productId as number, list);
    }
    const faqsByProduct = new Map<number, RowDataPacket[]>();
    for (const row of faqs) {
      const list = faqsByProduct.get(row.productId as number) ?? [];
      list.push(row);
      faqsByProduct.set(row.productId as number, list);
    }
    const optionsByProduct = new Map<
      number,
      Map<number, { id: number; name: string; order: number; productoptionvalue: { id: number; value: string; order: number }[] }>
    >();
    for (const row of options) {
      const pid = row.productId as number;
      const optMap = optionsByProduct.get(pid) ?? new Map();
      const opt = optMap.get(row.id as number) ?? {
        id: row.id as number,
        name: row.name as string,
        order: row.order as number,
        productoptionvalue: [],
      };
      if (row.valueId != null) {
        opt.productoptionvalue.push({
          id: row.valueId as number,
          value: row.valueValue as string,
          order: row.valueOrder as number,
        });
      }
      optMap.set(opt.id, opt);
      optionsByProduct.set(pid, optMap);
    }

    const brandIds = [
      ...new Set(
        products
          .map((p) => p.brandId as number | null)
          .filter((b): b is number => b != null),
      ),
    ];
    const variantIds = variants.map((v) => v.id as number);
    const [assembledVariants, variantIngredients, brandRows] = await Promise.all([
      this.loadVariantsWithRelations(variantIds, outletId),
      this.loadIngredientLinks(
        variantIds.length
          ? `variantId IN (${variantIds.map(() => '?').join(', ')})`
          : '1 = 0',
        variantIds,
        outletId,
      ),
      brandIds.length
        ? this.db.query<BrandLiteRow[]>(
            `SELECT id, name, logoUrl FROM brand WHERE id IN (${brandIds
              .map(() => '?')
              .join(', ')})`,
            brandIds,
          )
        : Promise.resolve([] as BrandLiteRow[]),
    ]);
    const brandById = new Map(
      brandRows.map((b) => [
        b.id,
        { id: b.id, name: b.name, logoUrl: b.logoUrl },
      ]),
    );
    const variantsByProduct = new Map<number, AssembledVariant[]>();
    for (const v of variants) {
      const list = variantsByProduct.get(v.productId as number) ?? [];
      list.push(assembledVariants.get(v.id as number)!);
      variantsByProduct.set(v.productId as number, list);
    }
    void variantIngredients; // already folded into assembledVariants via loadVariantsWithRelations

    const productIngredientsByProduct = new Map<number, AssembledIngredientLink[]>();
    for (const row of productIngredients) {
      const list = productIngredientsByProduct.get(row.productId) ?? [];
      list.push(this.rowToIngredientLink(row));
      productIngredientsByProduct.set(row.productId, list);
    }

    for (const p of products) {
      const id = p.id as number;
      result.set(id, {
        ...(p as unknown as Record<string, unknown>),
        id,
        shopId: p.shopId as number,
        name: p.name as string,
        price: trimDecimal(p.price as string),
        compareAtPrice: trimDecimal(p.compareAtPrice as string | null),
        costPrice: trimDecimal(p.costPrice as string | null),
        weight: trimDecimal(p.weight as string | null),
        giftCardCustomAmountMin: trimDecimal(p.giftCardCustomAmountMin as string | null),
        giftCardCustomAmountMax: trimDecimal(p.giftCardCustomAmountMax as string | null),
        thumbnail: p.thumbnail as string,
        sku: p.sku as string,
        usesIngredients: Boolean(p.usesIngredients),
        brandId: (p.brandId as number | null) ?? null,
        brand:
          p.brandId != null ? (brandById.get(p.brandId as number) ?? null) : null,
        productcollection: collectionsByProduct.get(id) ?? [],
        producttag: tagsByProduct.get(id) ?? [],
        productimage: (imagesByProduct.get(id) ?? []).map((i) => ({
          id: i.id as number,
          url: i.url as string,
          order: i.order as number,
        })),
        productattribute: (attributesByProduct.get(id) ?? []).map((a) => ({
          id: a.id as number,
          name: a.name as string,
          value: a.value as string,
          order: a.order as number,
        })),
        productfaq: (faqsByProduct.get(id) ?? []).map((f) => ({
          id: f.id as number,
          question: f.question as string,
          answer: f.answer as string,
          order: f.order as number,
        })),
        productoption: [...(optionsByProduct.get(id)?.values() ?? [])],
        productvariant: variantsByProduct.get(id) ?? [],
        productingredient: productIngredientsByProduct.get(id) ?? [],
      } as unknown as AssembledProduct);
    }
    return result;
  }

  // Sub-loader for a set of variant ids — used both standalone
  // (updateVariant's response) and as part of loadProductsWithRelations.
  async loadVariantsWithRelations(
    variantIds: number[],
    outletId: number | undefined,
  ): Promise<Map<number, AssembledVariant>> {
    const result = new Map<number, AssembledVariant>();
    if (variantIds.length === 0) return result;
    const idList = variantIds.map(() => '?').join(', ');

    const [rows, ingredientLinks] = await Promise.all([
      this.db.query<VariantRow[]>(
        `SELECT v.*, img.url AS imageUrl,
                ov1.value AS optionValue1Value, ov2.value AS optionValue2Value, ov3.value AS optionValue3Value
         FROM productvariant v
         LEFT JOIN productimage img ON img.id = v.imageId
         LEFT JOIN productoptionvalue ov1 ON ov1.id = v.optionValue1Id
         LEFT JOIN productoptionvalue ov2 ON ov2.id = v.optionValue2Id
         LEFT JOIN productoptionvalue ov3 ON ov3.id = v.optionValue3Id
         WHERE v.id IN (${idList})`,
        variantIds,
      ),
      this.loadIngredientLinks(
        `variantId IN (${idList})`,
        variantIds,
        outletId,
      ),
    ]);
    const ingredientsByVariant = new Map<number, AssembledIngredientLink[]>();
    for (const row of ingredientLinks) {
      const vId = row.variantId as number;
      const list = ingredientsByVariant.get(vId) ?? [];
      list.push(this.rowToIngredientLink(row));
      ingredientsByVariant.set(vId, list);
    }

    for (const v of rows) {
      result.set(v.id, {
        id: v.id,
        sku: v.sku,
        barcode: v.barcode,
        price: trimDecimal(v.price),
        compareAtPrice: trimDecimal(v.compareAtPrice),
        weight: trimDecimal(v.weight),
        imageId: v.imageId,
        image: v.imageUrl !== null ? { url: v.imageUrl } : null,
        order: v.order,
        optionValue1Id: v.optionValue1Id,
        optionValue1: v.optionValue1Value !== null ? { value: v.optionValue1Value } : null,
        optionValue2Id: v.optionValue2Id,
        optionValue2: v.optionValue2Value !== null ? { value: v.optionValue2Value } : null,
        optionValue3Id: v.optionValue3Id,
        optionValue3: v.optionValue3Value !== null ? { value: v.optionValue3Value } : null,
        productingredient: ingredientsByVariant.get(v.id) ?? [],
      });
    }
    return result;
  }

  // Shared by loadProductsWithRelations (product-level default rows,
  // variantId IS NULL) and loadVariantsWithRelations (a variant's own
  // override rows) — joins in the ingredient's own fields plus (only when
  // outletId is resolved) its live stock at that outlet, needed for the
  // effective-makeable-quantity display.
  async loadIngredientLinks(
    whereSql: string,
    whereParams: QueryParam[],
    outletId: number | undefined,
  ): Promise<IngredientLinkRow[]> {
    if (whereParams.length === 0) return [];
    const stockJoin =
      outletId !== undefined
        ? `LEFT JOIN outletingredientstock ois ON ois.ingredientId = ing.id AND ois.outletId = ?`
        : '';
    const stockColumns =
      outletId !== undefined
        ? `ois.stockQuantity AS stockQuantity, ois.lowStockThreshold AS lowStockThreshold`
        : `NULL AS stockQuantity, NULL AS lowStockThreshold`;
    // outletId's `?` (in the JOIN clause) appears before whereSql's `?`s (in
    // the WHERE clause) in the SQL text below — params must be in that same
    // order since .query() binds positionally, not by clause.
    const params = outletId !== undefined ? [outletId, ...whereParams] : whereParams;
    return this.db.query<IngredientLinkRow[]>(
      `SELECT pi.id, pi.productId, pi.variantId, pi.ingredientId, pi.quantityPerUnit,
              ing.name AS ingredientName, ing.unit AS ingredientUnit, ing.trackInventory AS ingredientTrackInventory,
              ${stockColumns}
       FROM productingredient pi
       JOIN ingredient ing ON ing.id = pi.ingredientId
       ${stockJoin}
       WHERE pi.${whereSql}
       ORDER BY pi.id ASC`,
      params,
    );
  }

  rowToIngredientLink(row: IngredientLinkRow): AssembledIngredientLink {
    return {
      id: row.id,
      productId: row.productId,
      variantId: row.variantId,
      ingredientId: row.ingredientId,
      quantityPerUnit: row.quantityPerUnit,
      ingredient: {
        name: row.ingredientName,
        unit: row.ingredientUnit,
        trackInventory: Boolean(row.ingredientTrackInventory),
        ...(row.stockQuantity !== null && {
          outletingredientstock: [
            { stockQuantity: row.stockQuantity, lowStockThreshold: row.lowStockThreshold },
          ],
        }),
      },
    };
  }

  toResponse(product: AssembledProduct, totalSold = 0) {
    const {
      productcollection,
      producttag,
      productimage,
      productattribute,
      productfaq,
      productoption,
      productvariant,
      productingredient,
      ...rest
    } = product;
    const options = productoption.map((o) => ({
      id: o.id,
      name: o.name,
      order: o.order,
      values: o.productoptionvalue.map((v) => ({
        id: v.id,
        value: v.value,
        order: v.order,
      })),
    }));
    const availability = this.computeIngredientAvailability(productingredient);
    // A usesIngredients:false product's own recipe is always exactly its
    // one auto-managed shadow row (quantityPerUnit: 1) — never shown to the
    // merchant as "ingredients" (see ingredient.shadowProductId's schema
    // comment); the shadow row's own outletingredientstock.lowStockThreshold
    // is this product's real low-stock alert setting. A usesIngredients:true
    // product has no single meaningful threshold across a multi-ingredient
    // recipe — merchants set thresholds per-ingredient on the Ingredients
    // page instead, so this is permanently null here.
    const lowStockThreshold = rest.usesIngredients
      ? null
      : (productingredient[0]?.ingredient.outletingredientstock?.[0]
          ?.lowStockThreshold ?? null);
    return {
      ...rest,
      collections: productcollection.map((pc) => pc.collection),
      tags: producttag.map((pt) => pt.tag.name),
      images: productimage.map((i) => ({
        id: i.id,
        url: i.url,
        order: i.order,
      })),
      attributes: productattribute.map((a) => ({
        id: a.id,
        name: a.name,
        value: a.value,
        order: a.order,
      })),
      faqs: productfaq.map((f) => ({
        id: f.id,
        question: f.question,
        answer: f.answer,
        order: f.order,
      })),
      hasVariants: options.length > 0,
      options,
      variants: productvariant.map((v) =>
        this.toVariantResponse(v, productingredient, rest.usesIngredients as boolean),
      ),
      // Ingredient-derived (Phase A) — makeableQuantity below is now the
      // SAME computation, since a shadow product's "recipe" is always
      // exactly one ingredient at quantityPerUnit 1 (floor(stock/1) =
      // stock). null when no outlet was resolved for this request (e.g. an
      // admin viewing the catalog without picking a branch) — distinct from
      // 0, which means "this outlet genuinely has none in stock".
      stockQuantity: availability.makeableQuantity,
      lowStockThreshold,
      totalSold,
      // This product's own default recipe (variantId: null rows only; see
      // productIngredientIncludeFor) — empty for a usesIngredients:false
      // product, whose one row is its own internal shadow link, never
      // merchant-authored/editable. A variant's effective recipe (its own
      // override, or this same default) is on each variant response
      // instead — see toVariantResponse.
      ingredients: rest.usesIngredients
        ? productingredient.map((pi) => this.toIngredientLinkResponse(pi))
        : [],
      // Ingredient-stock-derived, same computation as stockQuantity above —
      // kept as a separate field for the admin UI's existing
      // "makeableQuantity < stockQuantity" amber-warning comparison
      // (structurally always equal for a shadow product now; only a real
      // multi-ingredient recipe can ever differ). null when no recipe row
      // exists at all, or no outlet was resolved for this request.
      makeableQuantity: availability.makeableQuantity,
      limitedByIngredient: availability.limitedByIngredient,
    };
  }

  toVariantResponse(
    v: AssembledVariant,
    productDefaultIngredients: AssembledIngredientLink[],
    usesIngredients: boolean,
  ) {
    // A variant with its own override rows (its own shadow, when
    // usesIngredients:false and this product has variants, or a real
    // merchant-authored override) uses exactly those; one with none
    // inherits the product-level default wholesale (not merged
    // ingredient-by-ingredient — setting ANY override row for a variant
    // means that variant's recipe is now fully described by its own rows).
    const effectiveIngredientRows =
      v.productingredient.length > 0
        ? v.productingredient
        : productDefaultIngredients;
    const availability = this.computeIngredientAvailability(
      effectiveIngredientRows,
    );
    const lowStockThreshold = usesIngredients
      ? null
      : (v.productingredient[0]?.ingredient.outletingredientstock?.[0]
          ?.lowStockThreshold ?? null);
    return {
      id: v.id,
      sku: v.sku,
      barcode: v.barcode,
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      weight: v.weight,
      imageId: v.imageId,
      imageUrl: v.image?.url ?? null,
      order: v.order,
      optionValue1Id: v.optionValue1Id,
      optionValue2Id: v.optionValue2Id,
      optionValue3Id: v.optionValue3Id,
      label: buildVariantLabel([
        v.optionValue1?.value,
        v.optionValue2?.value,
        v.optionValue3?.value,
      ]),
      stockQuantity: availability.makeableQuantity,
      lowStockThreshold,
      // This variant's own override rows only (empty when it has none and
      // simply inherits the product default), and never the internal
      // shadow row for a usesIngredients:false variant — same "never shown
      // as a merchant-editable ingredient" reasoning as toResponse's
      // `ingredients` field above.
      ingredientOverrides: usesIngredients
        ? v.productingredient.map((pi) => this.toIngredientLinkResponse(pi))
        : [],
      makeableQuantity: availability.makeableQuantity,
      limitedByIngredient: availability.limitedByIngredient,
    };
  }

  private toIngredientLinkResponse(pi: AssembledIngredientLink) {
    return {
      id: pi.id,
      ingredientId: pi.ingredientId,
      ingredientName: pi.ingredient.name,
      ingredientUnit: pi.ingredient.unit,
      quantityPerUnit: pi.quantityPerUnit,
    };
  }

  // Informational only (see toResponse's own comment on why this doesn't
  // gate anything yet) — the smallest "stock at this outlet ÷ quantityPerUnit"
  // across every *tracked* ingredient the effective recipe references is how
  // many more units could actually be made, independent of the product/
  // variant's own stock number. null (not 0/Infinity) whenever the number
  // can't be computed: no recipe defined at all (unconstrained — today's
  // behavior), or no outlet was resolved for this request (ingredient stock
  // wasn't fetched — see loadIngredientLinks).
  private computeIngredientAvailability(
    rows: AssembledIngredientLink[],
  ): { makeableQuantity: number | null; limitedByIngredient: string | null } {
    const trackedRows = rows.filter((r) => r.ingredient.trackInventory);
    if (trackedRows.length === 0)
      return { makeableQuantity: null, limitedByIngredient: null };

    let makeableQuantity = Infinity;
    let limitedByIngredient: string | null = null;
    for (const row of trackedRows) {
      const stockRow = row.ingredient.outletingredientstock?.[0];
      if (!stockRow)
        return { makeableQuantity: null, limitedByIngredient: null };
      const possible = Math.floor(stockRow.stockQuantity / row.quantityPerUnit);
      if (possible < makeableQuantity) {
        makeableQuantity = possible;
        limitedByIngredient = row.ingredient.name;
      }
    }
    return { makeableQuantity, limitedByIngredient };
  }

  async attachOutletStockBreakdown(
    shopId: number,
    response: ReturnType<ProductReadService['toResponse']>,
  ) {
    const outlets = await this.db.query<RowDataPacket[]>(
      `SELECT id, name FROM outlet WHERE shopId = ? ORDER BY id ASC`,
      [shopId],
    );

    // A usesIngredients:true product has no single stock number per outlet
    // across a multi-ingredient recipe — same "no per-product low-stock
    // alerting" boundary as toResponse's lowStockThreshold. Per-ingredient
    // breakdown is still available via the Ingredients page.
    if ((response as any).usesIngredients) {
      (response as any).stockByOutlet = [];
      for (const v of response.variants as any[]) v.stockByOutlet = [];
      return;
    }

    const productShadowRows =
      response.variants.length === 0
        ? await this.db.query<RowDataPacket[]>(
            `SELECT id FROM ingredient WHERE shadowProductId = ?`,
            [response.id],
          )
        : [];
    const productShadow = productShadowRows[0];
    const productStockByOutlet = productShadow
      ? new Map(
          (
            await this.db.query<RowDataPacket[]>(
              `SELECT outletId, stockQuantity FROM outletingredientstock WHERE ingredientId = ?`,
              [productShadow.id],
            )
          ).map((s) => [s.outletId as number, s.stockQuantity as number]),
        )
      : new Map<number, number>();
    (response as any).stockByOutlet = outlets.map((o) => ({
      outletId: o.id,
      outletName: o.name,
      stockQuantity: productStockByOutlet.get(o.id as number) ?? 0,
    }));

    if (response.variants.length === 0) return;
    const variantIds = response.variants.map((v) => v.id);
    const variantShadows = await this.db.query<RowDataPacket[]>(
      `SELECT id, shadowVariantId FROM ingredient WHERE shadowVariantId IN (${variantIds.map(() => '?').join(', ')})`,
      variantIds,
    );
    const shadowIngredientIdByVariant = new Map(
      variantShadows.map((s) => [s.shadowVariantId as number, s.id as number]),
    );
    const variantStock = variantShadows.length
      ? await this.db.query<RowDataPacket[]>(
          `SELECT outletId, ingredientId, stockQuantity FROM outletingredientstock WHERE ingredientId IN (${variantShadows.map(() => '?').join(', ')})`,
          variantShadows.map((s) => s.id),
        )
      : [];
    const byIngredient = new Map<number, Map<number, number>>();
    for (const row of variantStock) {
      const ingId = row.ingredientId as number;
      if (!byIngredient.has(ingId)) byIngredient.set(ingId, new Map());
      byIngredient.get(ingId)!.set(row.outletId as number, row.stockQuantity as number);
    }
    for (const v of response.variants as any[]) {
      const shadowIngredientId = shadowIngredientIdByVariant.get(v.id as number);
      const m =
        (shadowIngredientId !== undefined && byIngredient.get(shadowIngredientId)) ||
        new Map<number, number>();
      v.stockByOutlet = outlets.map((o) => ({
        outletId: o.id,
        outletName: o.name,
        stockQuantity: m.get(o.id as number) ?? 0,
      }));
    }
  }
}
