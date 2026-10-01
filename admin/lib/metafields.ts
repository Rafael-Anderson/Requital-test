import type { MetafieldDefinition } from "@/lib/types";

// What a form control holds while the merchant is typing. Kept as strings for
// anything typed (so "1." or an empty box is representable) and converted to
// the real JSON value only when saving.
export type MetafieldDraft = string | boolean | string[] | null;

export function draftFromValue(
  def: Pick<MetafieldDefinition, "type">,
  value: unknown,
): MetafieldDraft {
  switch (def.type) {
    case "boolean":
      return typeof value === "boolean" ? value : null;
    case "multi_select":
      return Array.isArray(value) ? (value as string[]) : [];
    case "json":
      return value === null || value === undefined
        ? ""
        : JSON.stringify(value, null, 2);
    default:
      return value === null || value === undefined ? "" : String(value);
  }
}

export type DraftResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

// Empty means "no value" (null), which the API treats as clearing the field.
export function valueFromDraft(
  def: Pick<MetafieldDefinition, "type" | "name">,
  draft: MetafieldDraft,
): DraftResult {
  switch (def.type) {
    case "boolean":
      return { ok: true, value: typeof draft === "boolean" ? draft : null };
    case "multi_select": {
      const list = Array.isArray(draft) ? draft : [];
      return { ok: true, value: list.length === 0 ? null : list };
    }
    case "number": {
      const raw = typeof draft === "string" ? draft.trim() : "";
      if (raw === "") return { ok: true, value: null };
      const n = Number(raw);
      return Number.isFinite(n)
        ? { ok: true, value: n }
        : { ok: false, error: `${def.name} must be a number` };
    }
    case "json": {
      const raw = typeof draft === "string" ? draft.trim() : "";
      if (raw === "") return { ok: true, value: null };
      try {
        return { ok: true, value: JSON.parse(raw) as unknown };
      } catch {
        return { ok: false, error: `${def.name} is not valid JSON` };
      }
    }
    default: {
      const raw = typeof draft === "string" ? draft : "";
      return { ok: true, value: raw === "" ? null : raw };
    }
  }
}

// Only the entries whose value actually changed are sent, so saving a product
// never rewrites (or fails on) a custom field the merchant did not touch.
export function changedValues(
  defs: MetafieldDefinition[],
  initial: Record<number, MetafieldDraft>,
  drafts: Record<number, MetafieldDraft>,
):
  | { ok: true; values: { definitionId: number; value: unknown }[] }
  | { ok: false; error: string } {
  const values: { definitionId: number; value: unknown }[] = [];
  for (const def of defs) {
    const next = valueFromDraft(def, drafts[def.id] ?? null);
    if (!next.ok) return next;
    const prev = valueFromDraft(def, initial[def.id] ?? null);
    const prevValue = prev.ok ? prev.value : null;
    if (JSON.stringify(next.value) !== JSON.stringify(prevValue)) {
      values.push({ definitionId: def.id, value: next.value });
    }
  }
  return { ok: true, values };
}
