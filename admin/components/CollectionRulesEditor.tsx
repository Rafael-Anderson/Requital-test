"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { previewCollectionRules, resolveImageUrl } from "@/lib/api";
import {
  MAX_CONDITIONS,
  OPERATOR_LABELS,
  RULE_ATTRIBUTES,
  STATUS_OPTIONS,
  attributeFor,
  isRuleComplete,
  needsValue,
  newRule,
} from "@/lib/collection-rules";
import type { Collection, CollectionRule, CollectionRulePreview, CollectionRuleField } from "@/lib/types";
import Button from "@/components/ui/Button";
import Combobox from "@/components/ui/Combobox";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";

const PAGE_SIZE = 10;

export default function CollectionRulesEditor({
  matchMode,
  onMatchModeChange,
  rules,
  onRulesChange,
  manualCollections,
}: {
  matchMode: "all" | "any";
  onMatchModeChange: (mode: "all" | "any") => void;
  rules: CollectionRule[];
  onRulesChange: (rules: CollectionRule[]) => void;
  // Only manual collections can be a "Category" condition (no nesting of rules).
  manualCollections: Collection[];
}) {
  const [preview, setPreview] = useState<CollectionRulePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const latest = useRef(0);

  const complete = rules.every(isRuleComplete);
  const key = JSON.stringify([matchMode, rules, page]);

  // Debounced live preview. Incomplete conditions are not sent.
  useEffect(() => {
    if (!complete) return;
    const mine = ++latest.current;
    const timer = setTimeout(() => {
      previewCollectionRules({ matchMode, rules, page, pageSize: PAGE_SIZE })
        .then((result) => {
          if (mine !== latest.current) return;
          setPreview(result);
          setPreviewError(null);
        })
        .catch((err) => {
          if (mine !== latest.current) return;
          setPreviewError(err instanceof Error ? err.message : "Could not load the preview");
        });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, complete]);

  function update(index: number, patch: Partial<CollectionRule>) {
    setPage(1);
    onRulesChange(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function changeField(index: number, field: CollectionRuleField) {
    setPage(1);
    onRulesChange(rules.map((r, i) => (i === index ? newRule(field) : r)));
  }

  const totalPages = preview ? Math.max(1, Math.ceil(preview.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Products must match:</span>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name="collection-match-mode"
            checked={matchMode === "all"}
            onChange={() => {
              setPage(1);
              onMatchModeChange("all");
            }}
          />
          all conditions
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name="collection-match-mode"
            checked={matchMode === "any"}
            onChange={() => {
              setPage(1);
              onMatchModeChange("any");
            }}
          />
          any condition
        </label>
      </div>

      <div className="space-y-2">
        {rules.map((rule, index) => {
          const attr = attributeFor(rule.field);
          return (
            <div
              key={index}
              className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 rounded-lg border border-border dark:border-white/10 p-2.5"
            >
              <Combobox
                label="Attribute"
                ariaLabel={`Condition ${index + 1} attribute`}
                value={rule.field}
                onChange={(v) => changeField(index, v as CollectionRuleField)}
                searchPlaceholder="Search attributes"
                options={RULE_ATTRIBUTES.map((a) => ({ value: a.field, label: a.label }))}
              />
              <Select
                label="Operator"
                aria-label={`Condition ${index + 1} operator`}
                value={rule.operator}
                onChange={(e) => update(index, { operator: e.target.value })}
              >
                {attr.operators.map((op) => (
                  <option key={op} value={op}>
                    {OPERATOR_LABELS[op]}
                  </option>
                ))}
              </Select>
              {!needsValue(rule) ? (
                <div />
              ) : attr.kind === "status" ? (
                <Select
                  label="Value"
                  aria-label={`Condition ${index + 1} value`}
                  value={rule.value ?? "Available"}
                  onChange={(e) => update(index, { value: e.target.value })}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              ) : attr.kind === "category" ? (
                <Combobox
                  label="Value"
                  ariaLabel={`Condition ${index + 1} value`}
                  value={rule.value ?? ""}
                  onChange={(v) => update(index, { value: v })}
                  placeholder="Choose a collection"
                  options={manualCollections.map((c) => ({ value: String(c.id), label: c.name }))}
                />
              ) : (
                <Input
                  label="Value"
                  aria-label={`Condition ${index + 1} value`}
                  value={rule.value ?? ""}
                  inputMode={attr.kind === "number" || attr.kind === "integer" ? "decimal" : undefined}
                  maxLength={255}
                  onChange={(e) => update(index, { value: e.target.value })}
                />
              )}
              <Button
                type="button"
                variant="secondary"
                aria-label={`Remove condition ${index + 1}`}
                onClick={() => {
                  setPage(1);
                  onRulesChange(rules.filter((_, i) => i !== index));
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          );
        })}
      </div>

      <Button
        type="button"
        variant="secondary"
        disabled={rules.length >= MAX_CONDITIONS}
        onClick={() => onRulesChange([...rules, newRule("title")])}
      >
        <Plus className="size-4 inline -mt-0.5 me-1" />
        Add condition
      </Button>
      {rules.length >= MAX_CONDITIONS && (
        <p className="text-xs text-zinc-500">At most {MAX_CONDITIONS} conditions.</p>
      )}

      <div className="rounded-lg border border-border dark:border-white/10 p-3">
        {!complete ? (
          <p className="text-sm text-zinc-500">Finish the conditions to see matching products.</p>
        ) : previewError ? (
          <p className="text-sm text-red-600" role="alert">
            {previewError}
          </p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Add a condition. A collection with no conditions has no products.
          </p>
        ) : preview === null ? (
          <p className="text-sm text-zinc-500">Checking products...</p>
        ) : (
          <>
            <p className="text-sm font-medium" aria-live="polite">
              {preview.total} {preview.total === 1 ? "product matches" : "products match"}
            </p>
            {preview.data.length > 0 && (
              <ul className="mt-2 divide-y divide-border dark:divide-white/10">
                {preview.data.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 py-1.5 text-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={resolveImageUrl(p.thumbnail) ?? ""}
                      alt=""
                      className="size-8 rounded object-cover bg-zinc-100"
                    />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="text-xs text-zinc-500">{p.status}</span>
                  </li>
                ))}
              </ul>
            )}
            {totalPages > 1 && (
              <div className="mt-2 flex items-center justify-between text-sm">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <span>
                  Page {page} of {totalPages}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
