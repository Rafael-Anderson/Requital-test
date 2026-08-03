"use client";

import Link from "next/link";
import { Plus, X } from "lucide-react";
import Card from "@/components/ui/Card";

// Raw input, not components/ui/Input — that component always renders a
// visible label, which would repeat "Name"/"Value" on every row of a
// repeatable list. Same "raw styled input for a label-less field" escape
// hatch ProductForm.tsx's own tag-draft input already uses.
const FIELD_CLASS =
  "w-full border rounded px-2.5 py-1.5 text-sm dark:bg-zinc-900 outline-none focus:border-accent transition-colors";

export interface AttributeDraft {
  name: string;
  value: string;
  order: number;
}

// Informational, non-purchasable facts (e.g. Material: Cotton) — distinct
// from VariantsSection's options/variants above it. No own save endpoint:
// the draft list here is lifted into ProductForm's state and saved as part
// of the normal create/update payload (same as the media gallery), so this
// works in both create and edit mode, unlike VariantsSection which needs a
// real product id first.
export default function AttributesSection({
  attributes,
  onChange,
  shopAttributesEnabled,
}: {
  attributes: AttributeDraft[];
  onChange: (attributes: AttributeDraft[]) => void;
  shopAttributesEnabled: boolean;
}) {
  if (!shopAttributesEnabled) {
    return (
      <Card>
        <h3 className="text-sm font-semibold mb-1">Attributes</h3>
        <p className="text-sm text-zinc-500">
          Enable product attributes in{" "}
          <Link href="/settings/business/store-configuration" className="text-accent-text hover:underline">
            Settings &gt; Store Configuration
          </Link>{" "}
          to add informational facts like Material or Origin.
        </p>
      </Card>
    );
  }

  function update(index: number, patch: Partial<AttributeDraft>) {
    onChange(attributes.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  }

  function addRow() {
    onChange([...attributes, { name: "", value: "", order: attributes.length }]);
  }

  function removeRow(index: number) {
    onChange(attributes.filter((_, i) => i !== index).map((a, i) => ({ ...a, order: i })));
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Attributes</h3>
        <button
          type="button"
          onClick={addRow}
          className="flex items-center gap-1 text-sm text-accent-text hover:underline cursor-pointer"
        >
          <Plus className="size-4" /> Add attribute
        </button>
      </div>
      <p className="text-xs text-zinc-400">
        Informational facts shown on the product page — not purchasable options like Size/Color.
      </p>
      {attributes.length > 0 && (
        <div className="space-y-2">
          <div className="flex gap-2 text-xs font-medium text-zinc-500">
            <span className="flex-1">Name</span>
            <span className="flex-1">Value</span>
            <span className="w-7" />
          </div>
          {attributes.map((attr, i) => (
            <div key={i} className="flex items-start gap-2">
              <input
                aria-label="Attribute name"
                placeholder="e.g. Material"
                value={attr.name}
                onChange={(e) => update(i, { name: e.target.value })}
                className={`flex-1 ${FIELD_CLASS}`}
              />
              <input
                aria-label="Attribute value"
                placeholder="e.g. Cotton"
                value={attr.value}
                onChange={(e) => update(i, { value: e.target.value })}
                className={`flex-1 ${FIELD_CLASS}`}
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                aria-label="Remove attribute"
                className="h-9 flex items-center justify-center px-1 text-zinc-400 hover:text-red-600 cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
