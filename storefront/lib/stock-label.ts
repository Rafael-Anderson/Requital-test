// Shared "In stock / Only N left / Out of stock" line — the PDP
// (ProductDetailClient) and the product_stock card sub-block (§8.13.C item
// 18) render the same three states off `product.stockQuantity`.
// null ⇒ unlimited / no outlet context ⇒ treated as in stock.
export type StockTone = "ok" | "low" | "out";

export function stockLabel(stock: number | null): { text: string; tone: StockTone } {
  if (stock === null) return { text: "In stock", tone: "ok" };
  if (stock <= 0) return { text: "Out of stock", tone: "out" };
  if (stock <= 5) return { text: `Only ${stock} left`, tone: "low" };
  return { text: "In stock", tone: "ok" };
}
