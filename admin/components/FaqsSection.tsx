"use client";

import Link from "next/link";
import { Plus, X } from "lucide-react";
import Card from "@/components/ui/Card";

const FIELD_CLASS =
  "w-full border rounded px-2.5 py-1.5 text-sm dark:bg-zinc-900 outline-none focus:border-accent transition-colors";

export interface FaqDraft {
  question: string;
  answer: string;
  order: number;
}

// Same lifted-state, no-own-save-endpoint shape as AttributesSection — see
// that component's comment.
export default function FaqsSection({
  faqs,
  onChange,
  shopFaqsEnabled,
}: {
  faqs: FaqDraft[];
  onChange: (faqs: FaqDraft[]) => void;
  shopFaqsEnabled: boolean;
}) {
  if (!shopFaqsEnabled) {
    return (
      <Card>
        <h3 className="text-sm font-semibold mb-1">FAQs</h3>
        <p className="text-sm text-zinc-500">
          Enable product FAQs in{" "}
          <Link href="/settings/business/store-configuration" className="text-accent-text hover:underline">
            Settings &gt; Store Configuration
          </Link>{" "}
          to add question/answer pairs to this product.
        </p>
      </Card>
    );
  }

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
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">FAQs</h3>
        <button
          type="button"
          onClick={addRow}
          className="flex items-center gap-1 text-sm text-accent-text hover:underline cursor-pointer"
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
    </Card>
  );
}
