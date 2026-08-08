"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  commitScan,
  getScanSettings,
  listCategories,
  listIngredients,
  listOutlets,
  listProducts,
  previewScan,
  updateScanSettings,
} from "@/lib/api";
import type {
  Category,
  Ingredient,
  Outlet,
  Product,
  ScanCommitItem,
  ScanMatchSuggestion,
  ScanPreviewResult,
  ScanSettings,
} from "@/lib/types";
import PageShell from "@/components/ui/PageShell";
import BackButton from "@/components/ui/BackButton";
import InventoryTabs from "@/components/InventoryTabs";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import ImageDropzone from "@/components/ui/ImageDropzone";
import Toggle from "@/components/ui/Toggle";
import { useToast } from "@/components/ui/Toast";

// One per parsed OCR line — starts from the server's ScanPreviewItem but is
// fully editable before commit, since Tesseract's accuracy is nowhere near
// a vision LLM's (see the task this was built for) and the review step is
// the actual mitigation, not optional polish.
interface ReviewRow {
  key: string;
  rawLine: string;
  name: string;
  quantity: string;
  targetType: "product" | "ingredient";
  matchedId: number | null; // null = create new
  // Set only when matchedId resolves to a variant-carrying product — which
  // specific variant this line's stock/price lands on.
  variantId: number | null;
  suggestions: ScanMatchSuggestion[];
  outletId: number | "";
  skip: boolean;
  newPrice: string;
  newCategoryId: number | "";
  newUnit: string;
  // OCR-parsed cost, editable, sent as the commit item's `price` regardless
  // of matched vs. newly-created (see ScanCommitItem.price).
  costPrice: string;
}

const SELECT_CLASS =
  "flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20";

function KeywordChips({
  label,
  hint,
  values,
  onChange,
}: {
  label: string;
  hint: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  function add() {
    const raw = draft.trim();
    if (!raw || values.some((v) => v.toLowerCase() === raw.toLowerCase())) return;
    onChange([...values, raw]);
    setDraft("");
  }
  return (
    <div>
      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1">{label}</label>
      <p className="text-xs text-zinc-400 mb-2">{hint}</p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-full bg-black/5 dark:bg-white/10 px-2.5 py-1 text-xs"
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              aria-label={`Remove ${v}`}
              className="text-zinc-400 hover:text-red-600 cursor-pointer"
            >
              ×
            </button>
          </span>
        ))}
        {values.length === 0 && <span className="text-xs text-zinc-400">None</span>}
      </div>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        placeholder="Add a keyword and press Enter"
        className="w-full border rounded px-2.5 py-1.5 text-sm dark:bg-zinc-900 outline-none focus:border-accent transition-colors"
      />
    </div>
  );
}

export default function ScanToStockPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<ScanSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanPreviewResult | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [rawTextOpen, setRawTextOpen] = useState(false);
  const [committing, setCommitting] = useState(false);

  function refreshCatalog() {
    listProducts().then(setProducts);
    listIngredients().then(setIngredients);
  }

  useEffect(() => {
    getScanSettings().then(setSettings);
    listOutlets().then(setOutlets);
    listCategories().then(setCategories);
    refreshCatalog();
  }, []);

  async function saveSettings(patch: Partial<ScanSettings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      await updateScanSettings(patch);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save scan settings", "error");
    }
  }

  function handleFileSelected(f: File) {
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
    setRows([]);
  }

  async function handleScan() {
    if (!file) return;
    setScanning(true);
    try {
      const res = await previewScan(file);
      setResult(res);
      setRows(
        res.items.map((item, i) => {
          // "always ask" still seeds the top suggestion (it's just a
          // starting point the merchant reviews either way); "always create
          // new" ignores suggestions entirely and starts every row as a
          // fresh create.
          const topMatch = res.unmatchedBehavior === "create" ? undefined : item.suggestions[0];
          return {
            key: `row-${i}`,
            rawLine: item.rawLine,
            name: item.name,
            quantity: String(item.quantity || 1),
            targetType: (topMatch?.type ?? "product") as "product" | "ingredient",
            matchedId: topMatch?.id ?? null,
            variantId: null,
            suggestions: item.suggestions,
            outletId: res.defaultOutletId ?? "",
            skip: false,
            newPrice: item.price !== null ? String(item.price) : "",
            newCategoryId: "",
            newUnit: "",
            costPrice: item.price !== null ? String(item.price) : "",
          };
        }),
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to scan image", "error");
    } finally {
      setScanning(false);
    }
  }

  function updateRow(key: string, patch: Partial<ReviewRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function handleCommit() {
    if (!result) return;
    const active = rows.filter((r) => !r.skip);
    if (active.length === 0) {
      toast("Nothing to commit — every row is skipped", "error");
      return;
    }
    for (const r of active) {
      if (!r.outletId) {
        toast(`Pick an outlet for "${r.name}"`, "error");
        return;
      }
      if (r.matchedId === null) {
        if (r.targetType === "product" && (!r.newPrice || !r.newCategoryId)) {
          toast(`"${r.name}" needs a price and category to create as a new product`, "error");
          return;
        }
        if (r.targetType === "ingredient" && !r.newUnit.trim()) {
          toast(`"${r.name}" needs a unit to create as a new ingredient`, "error");
          return;
        }
      } else if (r.targetType === "product") {
        const matchedProduct = products.find((p) => p.id === r.matchedId);
        if (matchedProduct?.usesIngredients) {
          toast(`"${r.name}" uses a recipe — scan its ingredients individually instead`, "error");
          return;
        }
        if (matchedProduct?.hasVariants && !r.variantId) {
          toast(`"${r.name}" has variants — select which one this line is for`, "error");
          return;
        }
      }
    }

    setCommitting(true);
    try {
      const items: ScanCommitItem[] = active.map((r) => ({
        targetType: r.targetType,
        outletId: Number(r.outletId),
        quantity: Number(r.quantity) || 1,
        ...(r.costPrice && { price: Number(r.costPrice) }),
        ...(r.matchedId !== null
          ? { matchedId: r.matchedId, ...(r.variantId !== null && { variantId: r.variantId }) }
          : {
              createNew:
                r.targetType === "product"
                  ? { name: r.name, price: Number(r.newPrice), categoryId: Number(r.newCategoryId) }
                  : { name: r.name, unit: r.newUnit.trim() },
            }),
      }));
      const commitResult = await commitScan(result.imageUrl, items);
      toast(
        `Received: ${commitResult.created} new item${commitResult.created === 1 ? "" : "s"} created, stock added for ${commitResult.updated} existing item${commitResult.updated === 1 ? "" : "s"}`,
      );
      setResult(null);
      setRows([]);
      setFile(null);
      setPreview(null);
      refreshCatalog();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to commit scan", "error");
    } finally {
      setCommitting(false);
    }
  }

  return (
    <PageShell>
      <BackButton href="/inventory" />
      <InventoryTabs />
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Scan to Stock</h1>
      </div>
      <p className="text-sm text-zinc-500 -mt-2 mb-4">
        Photograph a supplier invoice or receipt — OCR pulls out candidate line items for you to review before
        anything is added to stock.
      </p>

      <Card className="mb-4">
        <button
          type="button"
          onClick={() => setSettingsOpen((o) => !o)}
          className="flex items-center gap-1.5 text-sm font-medium cursor-pointer"
        >
          {settingsOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          Scan settings
        </button>
        {settingsOpen && settings && (
          <div className="mt-4 space-y-4">
            <KeywordChips
              label="Exclude keywords"
              hint="Any OCR line containing one of these (case-insensitive) is dropped before parsing — subtotal, tax, etc."
              values={settings.excludeKeywords}
              onChange={(v) => saveSettings({ excludeKeywords: v })}
            />
            <KeywordChips
              label="Include-only keywords"
              hint="If set, only lines containing at least one of these are treated as candidates. Leave empty to consider every line."
              values={settings.includeKeywords}
              onChange={(v) => saveSettings({ includeKeywords: v })}
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">
                  Default outlet
                </label>
                <select
                  value={settings.defaultOutletId ?? ""}
                  onChange={(e) => saveSettings({ defaultOutletId: e.target.value ? Number(e.target.value) : null })}
                  className={SELECT_CLASS}
                >
                  <option value="">— None —</option>
                  {outlets.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">
                  Unmatched items default to
                </label>
                <div className="flex items-center gap-2 h-9">
                  <span className="text-sm">Ask</span>
                  <Toggle
                    checked={settings.unmatchedBehavior === "create"}
                    onChange={(checked) => saveSettings({ unmatchedBehavior: checked ? "create" : "ask" })}
                  />
                  <span className="text-sm">Always create new</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card className="mb-4">
        <ImageDropzone preview={preview} onFileSelected={handleFileSelected} label="Invoice / receipt photo" />
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={handleScan} disabled={!file || scanning}>
            {scanning ? "Scanning…" : "Scan"}
          </Button>
        </div>
      </Card>

      {result && (
        <>
          <Card className="mb-4">
            <button
              type="button"
              onClick={() => setRawTextOpen((o) => !o)}
              className="flex items-center gap-1.5 text-sm font-medium cursor-pointer"
            >
              {rawTextOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              Raw OCR text (for manual cross-check)
            </button>
            {rawTextOpen && (
              <pre className="mt-3 text-xs whitespace-pre-wrap bg-black/5 dark:bg-white/5 rounded p-3 max-h-64 overflow-y-auto">
                {result.rawText || "(no text detected)"}
              </pre>
            )}
          </Card>

          {rows.length === 0 ? (
            <Card>
              <p className="text-sm text-zinc-500">
                No candidate lines survived filtering — check Scan settings, or use the raw OCR text above to add
                items in the normal Inventory pages.
              </p>
            </Card>
          ) : (
            <>
              <div className="space-y-3 mb-4">
                {rows.map((row) => (
                  <Card key={row.key} data-row-key={row.key} className={row.skip ? "opacity-50" : ""}>
                    <div className="flex items-start gap-3 mb-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-zinc-400 truncate" title={row.rawLine}>
                          {row.rawLine}
                        </p>
                        <input
                          type="text"
                          value={row.name}
                          onChange={(e) => updateRow(row.key, { name: e.target.value })}
                          className="mt-1 w-full border rounded px-2.5 py-1.5 text-sm font-medium dark:bg-zinc-900 outline-none focus:border-accent transition-colors"
                        />
                      </div>
                      <label className="flex items-center gap-1.5 text-xs text-zinc-500 shrink-0 pt-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={row.skip}
                          onChange={(e) => updateRow(row.key, { skip: e.target.checked })}
                        />
                        Skip this line
                      </label>
                    </div>

                    {!row.skip && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <label className="text-xs text-zinc-500 block mb-1">Match / create as</label>
                          <select
                            value={row.matchedId === null ? `new:${row.targetType}` : `${row.targetType}:${row.matchedId}`}
                            onChange={(e) => {
                              const [kind, rest] = e.target.value.split(":");
                              if (kind === "new") {
                                updateRow(row.key, {
                                  matchedId: null,
                                  variantId: null,
                                  targetType: rest as "product" | "ingredient",
                                });
                              } else {
                                updateRow(row.key, {
                                  matchedId: Number(rest),
                                  variantId: null,
                                  targetType: kind as "product" | "ingredient",
                                });
                              }
                            }}
                            className={SELECT_CLASS}
                          >
                            <option value="new:product">+ Create new product</option>
                            <option value="new:ingredient">+ Create new ingredient</option>
                            {row.suggestions.length > 0 && (
                              <optgroup label="Suggested matches">
                                {row.suggestions.map((s) => (
                                  <option key={`${s.type}-${s.id}`} value={`${s.type}:${s.id}`}>
                                    {s.name} ({s.type}, {Math.round(s.score * 100)}% match)
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            <optgroup label="All products">
                              {products.map((p) => (
                                <option key={`product-${p.id}`} value={`product:${p.id}`}>
                                  {p.name}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="All ingredients">
                              {ingredients.map((i) => (
                                <option key={`ingredient-${i.id}`} value={`ingredient:${i.id}`}>
                                  {i.name}
                                </option>
                              ))}
                            </optgroup>
                          </select>
                          {row.matchedId !== null &&
                            row.targetType === "product" &&
                            products.find((p) => p.id === row.matchedId)?.usesIngredients && (
                              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                                This product uses a recipe — scan its ingredients individually instead.
                              </p>
                            )}
                        </div>

                        {row.matchedId !== null &&
                          row.targetType === "product" &&
                          (() => {
                            const matchedProduct = products.find((p) => p.id === row.matchedId);
                            if (!matchedProduct?.hasVariants) return null;
                            return (
                              <div>
                                <label className="text-xs text-zinc-500 block mb-1">Variant</label>
                                <select
                                  value={row.variantId ?? ""}
                                  onChange={(e) =>
                                    updateRow(row.key, { variantId: e.target.value ? Number(e.target.value) : null })
                                  }
                                  className={SELECT_CLASS}
                                >
                                  <option value="">— Pick —</option>
                                  {matchedProduct.variants.map((v) => (
                                    <option key={v.id} value={v.id}>
                                      {v.label ?? `Variant ${v.id}`}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            );
                          })()}

                        <div>
                          <label className="text-xs text-zinc-500 block mb-1">Cost price (AED)</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.costPrice}
                            onChange={(e) => updateRow(row.key, { costPrice: e.target.value })}
                            className="flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
                          />
                        </div>

                        <div>
                          <label className="text-xs text-zinc-500 block mb-1">Quantity to add</label>
                          <input
                            type="number"
                            min="0"
                            value={row.quantity}
                            onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                            className="flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
                          />
                        </div>

                        <div>
                          <label className="text-xs text-zinc-500 block mb-1">Outlet</label>
                          <select
                            value={row.outletId}
                            onChange={(e) => updateRow(row.key, { outletId: e.target.value ? Number(e.target.value) : "" })}
                            className={SELECT_CLASS}
                          >
                            <option value="">— Pick —</option>
                            {outlets.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        {row.matchedId === null && row.targetType === "product" && (
                          <>
                            <div>
                              <label className="text-xs text-zinc-500 block mb-1">New product price (AED)</label>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={row.newPrice}
                                onChange={(e) => updateRow(row.key, { newPrice: e.target.value })}
                                className="flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-zinc-500 block mb-1">New product category</label>
                              <select
                                value={row.newCategoryId}
                                onChange={(e) =>
                                  updateRow(row.key, { newCategoryId: e.target.value ? Number(e.target.value) : "" })
                                }
                                className={SELECT_CLASS}
                              >
                                <option value="">— Pick —</option>
                                {categories.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </>
                        )}

                        {row.matchedId === null && row.targetType === "ingredient" && (
                          <div>
                            <label className="text-xs text-zinc-500 block mb-1">New ingredient unit</label>
                            <input
                              type="text"
                              placeholder="e.g. stems, grams"
                              value={row.newUnit}
                              onChange={(e) => updateRow(row.key, { newUnit: e.target.value })}
                              className="flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                ))}
              </div>

              <div className="flex justify-end">
                <Button variant="primary" onClick={handleCommit} disabled={committing}>
                  {committing ? "Adding to stock…" : `Confirm and add to stock (${rows.filter((r) => !r.skip).length})`}
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </PageShell>
  );
}
