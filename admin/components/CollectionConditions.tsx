"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { previewCollectionRules, type CollectionRulePreview } from "@/lib/api";
import {
  MAX_RULES,
  OPERATOR_LABELS,
  RULE_FIELDS,
  conditionError,
  fieldDef,
  isPresenceOperator,
} from "@/lib/collection-rules";
import type { Collection } from "@/lib/types";
import Combobox from "@/components/ui/Combobox";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Thumbnail from "@/components/ui/Thumbnail";
import { formatMoney } from "@/lib/money";

export interface ConditionDraft {
  key: string;
  field: string;
  operator: string;
  value: string;
}

let nextKey = 1;
export function newConditionKey(): string {
  return `c${nextKey++}`;
}

const STATUSES = ["Available", "Unavailable", "Archived"];

export default function CollectionConditions({
  matchMode,
  onMatchModeChange,
  conditions,
  onConditionsChange,
  manualCollections,
  currency,
}: {
  matchMode: "all" | "any";
  onMatchModeChange: (m: "all" | "any") => void;
  conditions: ConditionDraft[];
  onConditionsChange: (c: ConditionDraft[]) => void;
  // Only manual collections can be a Category condition's target.
  manualCollections: Collection[];
  currency: string | null;
}) {
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState<CollectionRulePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  function update(key: string, patch: Partial<ConditionDraft>) {
    onConditionsChange(conditions.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }

  function addCondition(field: string) {
    const def = fieldDef(field);
    if (!def) return;
    onConditionsChange([
      ...conditions,
      { key: newConditionKey(), field, operator: def.operators[0], value: "" },
    ]);
    setAdding(false);
  }

  const errors = conditions.map((c) => conditionError(c));
  const allValid = conditions.length > 0 && errors.every((e) => e === null);
  const signature = JSON.stringify([matchMode, conditions.map((c) => [c.field, c.operator, c.value])]);

  // Live "N products match": debounced, and a stale response never overwrites a newer one.
  useEffect(() => {
    if (!allValid) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      previewCollectionRules({
        matchMode,
        rules: conditions.map((c) => ({
          field: c.field,
          operator: c.operator,
          value: isPresenceOperator(c.operator) ? null : c.value.trim(),
        })),
        pageSize: 10,
      })
        .then((r) => {
          if (seq.current !== mine) return;
          setPreview(r);
          setPreviewError(null);
        })
        .catch((e: unknown) => {
          if (seq.current !== mine) return;
          setPreview(null);
          setPreviewError(e instanceof Error ? e.message : "Could not load the preview");
        })
        .finally(() => {
          if (seq.current === mine) setLoading(false);
        });
    }, 400);
    return () => clearTimeout(t);
    // signature captures matchMode + every condition's field/operator/value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, allValid]);

  const usedUp = conditions.length >= MAX_RULES;

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-[13px] font-medium text-text-secondary dark:text-zinc-400">Products must match</p>
        <div className="flex flex-wrap gap-4 text-sm">
          {(["all", "any"] as const).map((m) => (
            <label key={m} className="flex items-center gap-2">
              <input
                type="radio"
                name="collection-match-mode"
                checked={matchMode === m}
                onChange={() => onMatchModeChange(m)}
              />
              {m === "all" ? "all conditions" : "any condition"}
            </label>
          ))}
        </div>
      </div>

      {conditions.length === 0 && (
        <p className="text-sm text-text-muted">No conditions yet. Add one to choose which products belong here.</p>
      )}

      <ul className="space-y-2">
        {conditions.map((c, i) => {
          const def = fieldDef(c.field);
          const err = errors[i];
          return (
            <li
              key={c.key}
              className="rounded-lg border border-border p-3 dark:border-white/10"
              data-testid="condition-row"
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-end">
                <Select
                  label="Attribute"
                  value={c.field}
                  onChange={(e) => {
                    const d = fieldDef(e.target.value);
                    update(c.key, { field: e.target.value, operator: d?.operators[0] ?? "equals", value: "" });
                  }}
                >
                  {RULE_FIELDS.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Comparison"
                  value={c.operator}
                  onChange={(e) => update(c.key, { operator: e.target.value })}
                >
                  {(def?.operators ?? []).map((op) => (
                    <option key={op} value={op}>
                      {OPERATOR_LABELS[op] ?? op}
                    </option>
                  ))}
                </Select>
                {isPresenceOperator(c.operator) ? (
                  <div className="hidden sm:block" />
                ) : def?.valueKind === "category" ? (
                  <Combobox
                    label="Value"
                    value={c.value}
                    onChange={(v) => update(c.key, { value: v })}
                    placeholder="Pick a collection"
                    options={manualCollections.map((m) => ({ value: String(m.id), label: m.name }))}
                  />
                ) : def?.valueKind === "status" ? (
                  <Select label="Value" value={c.value} onChange={(e) => update(c.key, { value: e.target.value })}>
                    <option value="">Pick a status</option>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    label="Value"
                    value={c.value}
                    inputMode={def?.valueKind === "number" ? "decimal" : undefined}
                    placeholder={def?.placeholder}
                    maxLength={255}
                    onChange={(e) => update(c.key, { value: e.target.value })}
                  />
                )}
                <button
                  type="button"
                  aria-label={`Remove condition ${i + 1}`}
                  className="mb-1 inline-flex size-9 items-center justify-center rounded-md text-text-muted hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={() => onConditionsChange(conditions.filter((x) => x.key !== c.key))}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              {err && c.value !== "" && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{err}</p>}
            </li>
          );
        })}
      </ul>

      {adding ? (
        <div className="max-w-sm">
          <Combobox
            label="Add condition"
            value=""
            onChange={addCondition}
            placeholder="Search attributes"
            searchPlaceholder="Search attributes"
            options={RULE_FIELDS.map((f) => ({ value: f.key, label: f.label }))}
          />
        </div>
      ) : (
        <button
          type="button"
          disabled={usedUp}
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-text hover:underline disabled:opacity-50 disabled:no-underline"
        >
          <Plus className="size-4" />
          Add condition
          {usedUp ? ` (max ${MAX_RULES})` : ""}
        </button>
      )}

      <div className="rounded-lg bg-black/[0.03] p-3 dark:bg-white/5" aria-live="polite">
        {!allValid ? (
          <p className="text-sm text-text-muted">Complete every condition to see which products match.</p>
        ) : previewError ? (
          <p className="text-sm text-red-600 dark:text-red-400">{previewError}</p>
        ) : preview ? (
          <>
            <p className="text-sm font-medium" data-testid="match-count">
              {preview.total === 1 ? "1 product matches" : `${preview.total} products match`}
              {loading ? " (updating)" : ""}
            </p>
            {preview.products.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {preview.products.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 text-sm">
                    <Thumbnail src={p.thumbnail} size="size-8" />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="text-text-muted">{formatMoney(p.price, currency)}</span>
                  </li>
                ))}
              </ul>
            )}
            {preview.total > preview.products.length && (
              <p className="mt-2 text-xs text-text-muted">Showing the first {preview.products.length}.</p>
            )}
            <p className="mt-2 text-xs text-text-muted">
              The storefront lists only Available products, whatever the Status conditions say.
            </p>
          </>
        ) : (
          <p className="text-sm text-text-muted">Loading the preview</p>
        )}
      </div>
    </div>
  );
}
