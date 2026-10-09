"use client";

import { useEffect, useState } from "react";
import { confirmShopifyImport, listCollections, listOutlets, previewShopifyImport } from "@/lib/api";
import type { Collection, Outlet, ProductImportSource, ShopifyImportReport, ShopifyProductReport } from "@/lib/types";
import Button from "@/components/ui/Button";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import Toggle from "@/components/ui/Toggle";
import { useToast } from "@/components/ui/Toast";

const ACTION_STYLES: Record<ShopifyProductReport["action"], string> = {
  create: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  update: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  skip: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

function show(value: string | null) {
  return value === null || value === "" ? "empty" : value.length > 80 ? `${value.slice(0, 80)}...` : value;
}

function ProductRow({ product }: { product: ShopifyProductReport }) {
  const hasDetail =
    product.changes.length > 0 ||
    product.variantChanges.length > 0 ||
    product.warnings.length > 0 ||
    product.errors.length > 0 ||
    product.reason;
  return (
    <details className="px-3 py-2 text-sm group">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{product.name || product.handle}</div>
          <div className="text-xs text-text-muted">
            {product.handle} - {product.variants.total} variant{product.variants.total === 1 ? "" : "s"},{" "}
            {product.images.total} image{product.images.total === 1 ? "" : "s"}
            {product.images.toAdd > 0 && product.action === "update" ? ` (${product.images.toAdd} new)` : ""}
            {product.stockUpdates > 0 ? `, stock for ${product.stockUpdates}` : ""}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${ACTION_STYLES[product.action]}`}>
          {product.action}
        </span>
      </summary>
      {hasDetail && (
        <div className="mt-2 space-y-2 ps-1">
          {product.reason && <p className="text-xs text-text-muted">{product.reason}</p>}
          {product.errors.length > 0 && (
            <ul className="text-xs text-red-600 dark:text-red-400">
              {product.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          {product.changes.length > 0 && (
            <ul className="text-xs">
              {product.changes.map((c, i) => (
                <li key={i}>
                  <span className="font-medium">{c.field}:</span> {show(c.from)} to {show(c.to)}
                </li>
              ))}
            </ul>
          )}
          {product.variantChanges.length > 0 && (
            <ul className="text-xs">
              {product.variantChanges.map((c, i) => (
                <li key={i}>
                  <span className="font-mono">{c.sku}</span> {c.field}: {show(c.from)} to {show(c.to)}
                </li>
              ))}
            </ul>
          )}
          {product.warnings.length > 0 && (
            <ul className="text-xs text-amber-700 dark:text-amber-400">
              {product.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </details>
  );
}

const SOURCES: Record<
  ProductImportSource,
  { title: string; intro: string; accept: string; collectionTip: string }
> = {
  shopify: {
    title: "Import from Shopify",
    intro: "Upload the products CSV exported from Shopify (Products, Export).",
    accept: ".csv,text/csv",
    collectionTip: "A Shopify product export has no collections, so new products go into the one you choose.",
  },
  salla: {
    title: "Import from Salla",
    intro: "Upload the products file exported from Salla (.xlsx or .csv, Arabic or English headers).",
    accept: ".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    collectionTip: "New products go into the collection you choose. Salla categories are not matched to your collections.",
  },
  zid: {
    title: "Import from Zid",
    intro: "Upload the products file exported from Zid (.xlsx or .csv).",
    accept: ".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    collectionTip: "New products go into the collection you choose. Zid categories are not matched to your collections.",
  },
};

// The Shopify, Salla and Zid sources of the product import wizard. Same stateless contract as
// CsvImportModal: preview writes nothing, confirm re-uploads the same file and
// the server re-parses and re-validates it.
export default function ShopifyImportModal({
  onClose,
  onImported,
  defaultOutletId,
  source = "shopify",
}: {
  onClose: () => void;
  onImported: () => void;
  defaultOutletId?: number | null;
  source?: ProductImportSource;
}) {
  const copy = SOURCES[source];
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [collectionId, setCollectionId] = useState("");
  const [outletId, setOutletId] = useState(defaultOutletId ? String(defaultOutletId) : "");
  const [onExisting, setOnExisting] = useState<"update" | "skip">("update");
  const [copyImages, setCopyImages] = useState(false);
  const [report, setReport] = useState<ShopifyImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCollections()
      .then(setCollections)
      .catch(() => setCollections([]));
    listOutlets()
      .then(setOutlets)
      .catch(() => setOutlets([]));
  }, []);

  const options = {
    source,
    copyImages,
    onExisting,
    collectionId: collectionId ? Number(collectionId) : undefined,
    outletId: outletId ? Number(outletId) : undefined,
  };
  const writable = report ? report.totals.create + report.totals.update : 0;

  function invalidate() {
    setReport(null);
    setError(null);
  }

  async function handlePreview() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setReport(await previewShopifyImport(file, options));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read this file");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!file) return;
    setBusy(true);
    try {
      const result = await confirmShopifyImport(file, options);
      toast(`Imported: ${result.created} created, ${result.updated} updated, ${result.skipped} unchanged`);
      onImported();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Import failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      size="lg"
      title={copy.title}
      footer={(requestClose) => (
        <>
          <Button type="button" variant="secondary" onClick={requestClose}>
            Cancel
          </Button>
          {!report ? (
            <Button type="button" variant="primary" onClick={handlePreview} disabled={!file || busy} loading={busy}>
              {busy ? "Reading..." : "Preview"}
            </Button>
          ) : (
            <Button type="button" variant="primary" onClick={handleConfirm} disabled={busy || writable === 0} loading={busy}>
              {busy ? "Importing..." : `Confirm import (${writable})`}
            </Button>
          )}
        </>
      )}
    >
      <p className="text-sm text-text-muted -mt-2 mb-4">
        {copy.intro} Nothing is saved until you review the preview and confirm.
      </p>

      <input
        type="file"
        accept={copy.accept}
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          invalidate();
        }}
        className="block w-full text-sm mb-4 file:me-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-black/5 dark:file:bg-white/10 file:text-sm file:cursor-pointer cursor-pointer"
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Select
          label="Put new products in"
          value={collectionId}
          onChange={(e) => {
            setCollectionId(e.target.value);
            invalidate();
          }}
          tooltip={copy.collectionTip}
        >
          <option value="">Choose a collection</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          label="Stock quantities go to"
          value={outletId}
          onChange={(e) => {
            setOutletId(e.target.value);
            invalidate();
          }}
        >
          <option value="">Do not import stock</option>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        <Select
          label="Products that already exist"
          value={onExisting}
          onChange={(e) => {
            setOnExisting(e.target.value === "skip" ? "skip" : "update");
            invalidate();
          }}
        >
          <option value="update">Update them</option>
          <option value="skip">Leave them alone</option>
        </Select>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <Toggle
          checked={copyImages}
          onChange={(v) => {
            setCopyImages(v);
            invalidate();
          }}
        />
        <div className="text-sm">
          <div className="font-medium">Copy images into Requital</div>
          <div className="text-xs text-text-muted">
            Off: images stay linked to their original address. On: they are downloaded in the background after the
            import (https addresses only, up to 10 per product and 500 per import).
          </div>
        </div>
      </div>

      {error && <InlineErrorMessage className="mb-3">{error}</InlineErrorMessage>}

      {report && (
        <div className="space-y-3 mb-4">
          <p className="text-sm">
            {report.totals.create} to create, {report.totals.update} to update, {report.totals.skip} unchanged,{" "}
            {report.totals.error} with errors. {report.totals.variants} variants, {report.totals.images} images.
          </p>
          <p className="text-xs text-text-muted">{report.currencyNote}</p>
          {report.imageCopy?.requested && (
            <p className="text-xs text-text-muted">
              {report.imageCopy.willQueue} image{report.imageCopy.willQueue === 1 ? "" : "s"} will be copied in the
              background
              {report.imageCopy.overCap > 0 ? `; ${report.imageCopy.overCap} over the limit stay linked` : ""}.
            </p>
          )}
          {report.warnings.length > 0 && (
            <ul className="text-xs text-amber-700 dark:text-amber-400 list-disc ps-4">
              {report.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <div className="border border-border rounded-lg dark:border-white/10 overflow-hidden">
            <div className="max-h-96 overflow-y-auto divide-y divide-black/5 dark:divide-white/10">
              {report.products.map((p) => (
                <ProductRow key={p.handle} product={p} />
              ))}
            </div>
            {report.truncated && (
              <div className="px-3 py-2 text-xs text-text-muted border-t border-gray-200 dark:border-white/10">
                Showing the first products only. Errors are listed first. The counts above cover the whole file.
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
