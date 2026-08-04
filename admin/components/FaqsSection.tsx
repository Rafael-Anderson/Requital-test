"use client";

import { Plus, X } from "lucide-react";
import ProductFeatureSection from "@/components/ProductFeatureSection";

const FIELD_CLASS =
  "w-full border rounded px-2.5 py-1.5 text-sm dark:bg-zinc-900 outline-none focus:border-accent transition-colors";

export interface FaqDraft {
  question: string;
  answer: string;
  order: number;
}

// Same lifted-state, no-own-save-endpoint shape as AttributesSection — see
// that component's comment. `enabled` is this product's own showFaqs flag
// (see useProductForm) — a per-product opt-in that replaced the old
// shop-wide productFaqsEnabled toggle.
export default function FaqsSection({
  faqs,
  onChange,
  enabled,
  defaultOpen,
  onEnable,
  onDisable,
}: {
  faqs: FaqDraft[];
  onChange: (faqs: FaqDraft[]) => void;
  enabled: boolean;
  defaultOpen: boolean;
  onEnable: () => void;
  onDisable: () => void;
}) {
  function update(index: number, patch: Partial<FaqDraft>) {
    onChange(faqs.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function addRow() {
    onChange([...faqs, { question: "", answer: "", order: faqs.length }]);
  }

  function removeRow(index: number) {
    onChange(faqs.filter((_, i) => i !== index).map((f, i) => ({ ...f, order: i })));
  }

  return (
    <ProductFeatureSection
      title="FAQs"
      addLabel="Add FAQs"
      enabled={enabled}
      defaultOpen={defaultOpen}
      onEnable={onEnable}
      onDisable={onDisable}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-400">Question/answer pairs shown on the product page.</p>
        <button
          type="button"
          onClick={addRow}
          className="flex items-center gap-1 text-sm text-accent-text hover:underline cursor-pointer shrink-0 ml-3"
        >
          <Plus className="size-4" /> Add FAQ
        </button>
      </div>
      {faqs.length > 0 && (
        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex-1 space-y-1.5">
                <input
                  aria-label="Question"
                  placeholder="Question"
                  value={faq.question}
                  onChange={(e) => update(i, { question: e.target.value })}
                  className={FIELD_CLASS}
                />
                <textarea
                  aria-label="Answer"
                  placeholder="Answer"
                  value={faq.answer}
                  onChange={(e) => update(i, { answer: e.target.value })}
                  rows={2}
                  className={`${FIELD_CLASS} resize-y`}
                />
              </div>
              <button
                type="button"
                onClick={() => removeRow(i)}
                aria-label="Remove FAQ"
                className="mt-1 flex items-center justify-center px-1 text-zinc-400 hover:text-red-600 cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </ProductFeatureSection>
  );
}
