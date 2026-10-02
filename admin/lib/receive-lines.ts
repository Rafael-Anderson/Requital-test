import type { PurchaseOrderLine, ReceivePurchaseOrderInput } from "@/lib/types";

export interface ReceiveDraft {
  lineId: number;
  quantity: string;
  unitCost: string;
}

export function outstanding(line: PurchaseOrderLine): number {
  return Math.max(0, line.quantityOrdered - line.quantityReceived);
}

// Defaults to receiving everything still outstanding at the ordered price.
export function initialReceiveDrafts(lines: PurchaseOrderLine[]): ReceiveDraft[] {
  return lines
    .filter((l) => outstanding(l) > 0 && l.ingredientId !== null)
    .map((l) => ({ lineId: l.id, quantity: String(outstanding(l)), unitCost: l.unitCost }));
}

// Turns the form into the API body. A blank or zero quantity means "not in this
// delivery" and is skipped; a unit cost is sent only when it differs from the
// ordered price, so an untouched field keeps the server's own captured figure.
export function toReceiveInput(
  drafts: ReceiveDraft[],
  lines: PurchaseOrderLine[],
): { input: Pick<ReceivePurchaseOrderInput, "lines"> } | { error: string } {
  const out: ReceivePurchaseOrderInput["lines"] = [];
  for (const d of drafts) {
    const line = lines.find((l) => l.id === d.lineId);
    if (!line) continue;
    const quantity = d.quantity.trim() === "" ? 0 : Number(d.quantity);
    if (!Number.isInteger(quantity) || quantity < 0) return { error: `${line.description}: quantity must be a whole number.` };
    if (quantity === 0) continue;
    if (quantity > outstanding(line)) return { error: `${line.description}: only ${outstanding(line)} still outstanding.` };
    const entry: ReceivePurchaseOrderInput["lines"][number] = { lineId: d.lineId, quantity };
    if (d.unitCost.trim() !== "" && Number(d.unitCost) !== Number(line.unitCost)) {
      const cost = Number(d.unitCost);
      if (!Number.isFinite(cost) || cost < 0) return { error: `${line.description}: unit cost must be zero or more.` };
      entry.unitCost = cost;
    }
    out.push(entry);
  }
  if (out.length === 0) return { error: "Enter a quantity for at least one line." };
  return { input: { lines: out } };
}
