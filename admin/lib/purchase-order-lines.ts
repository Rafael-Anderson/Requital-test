import type { PurchaseOrderLine, PurchaseOrderLineInput } from "@/lib/types";

// One editable row of the PO builder. `target` is "i:<ingredientId>",
// "p:<productId>" or "p:<productId>:<variantId>": a product-level pick, which the
// server resolves to that product's own stock ingredient.
export interface LineDraft {
  key: string;
  target: string;
  quantity: string;
  unitCost: string;
}

let counter = 0;
export function newDraft(partial: Partial<LineDraft> = {}): LineDraft {
  counter += 1;
  return { key: `l${counter}`, target: "", quantity: "1", unitCost: "", ...partial };
}

export function draftFromLine(line: PurchaseOrderLine): LineDraft {
  let target = "";
  if (line.productId !== null) {
    target = line.variantId !== null ? `p:${line.productId}:${line.variantId}` : `p:${line.productId}`;
  } else if (line.ingredientId !== null) {
    target = `i:${line.ingredientId}`;
  }
  return newDraft({ target, quantity: String(line.quantityOrdered), unitCost: line.unitCost });
}

// Returns the API lines, or a message for the first row that is not valid.
// A blank unit cost is omitted so the server can fill it from the supplier's
// catalogue (and refuses it when there is none).
export function toLineInputs(drafts: LineDraft[]): { lines: PurchaseOrderLineInput[] } | { error: string } {
  const lines: PurchaseOrderLineInput[] = [];
  for (const [i, d] of drafts.entries()) {
    const row = `Line ${i + 1}`;
    if (!d.target) return { error: `${row}: choose an item.` };
    const quantity = Number(d.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) return { error: `${row}: quantity must be a whole number of at least 1.` };
    const line: PurchaseOrderLineInput = { quantity };
    const [kind, id, variant] = d.target.split(":");
    if (kind === "i") line.ingredientId = Number(id);
    else {
      line.productId = Number(id);
      if (variant) line.variantId = Number(variant);
    }
    if (d.unitCost.trim() !== "") {
      const cost = Number(d.unitCost);
      if (!Number.isFinite(cost) || cost < 0) return { error: `${row}: unit cost must be zero or more.` };
      line.unitCost = cost;
    }
    lines.push(line);
  }
  if (lines.length === 0) return { error: "Add at least one line." };
  const seen = new Set(drafts.map((d) => d.target));
  if (seen.size !== drafts.length) return { error: "The same item is on more than one line." };
  return { lines };
}
