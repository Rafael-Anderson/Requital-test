"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { ImportConfirmResult, ImportPreviewResult, ImportRowResult } from "@/lib/types";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

const ACTION_STYLES: Record<ImportRowResult["action"], string> = {
  create: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  update: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  reject: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

// Generic across Products/Ingredients — both preview/confirm endpoints
// return the same { rows, created?, updated?, skipped? } shape (see
// backend's ImportRowResult). Nothing writes until "Confirm import": the
// same File is uploaded twice, once to previewFn (read-only) and, only on
// confirmation, again to confirmFn — see ProductsService.confirmImportProducts
// for why this pair is stateless rather than a preview-id handoff.
export default function CsvImportModal({
  title,
  previewFn,
  confirmFn,
  onClose,
  onImported,
}: {
  title: string;
  previewFn: (file: File) => Promise<ImportPreviewResult>;
  confirmFn: (file: File) => Promise<ImportConfirmResult>;
  onClose: () => void;
  onImported: () => void;
}) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportRowResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rejected = preview?.filter((r) => r.action === "reject").length ?? 0;
  const importable = (preview?.length ?? 0) - rejected;

  async function handlePreview() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await previewFn(file);
      setPreview(result.rows);
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
      const result = await confirmFn(file);
      toast(`Imported: ${result.created} created, ${result.updated} updated${result.skipped ? `, ${result.skipped} skipped` : ""}`);
      onImported();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Import failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-lg bg-white dark:bg-zinc-900 border dark:border-white/10 p-6 relative"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>

        <h2 className="text-lg font-semibold mb-1">{title}</h2>
        <p className="text-sm text-zinc-500 mb-4">
          Nothing is saved until you review the preview below and confirm.
        </p>

        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setPreview(null);
            setError(null);
          }}
          className="block w-full text-sm mb-4 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-black/5 dark:file:bg-white/10 file:text-sm file:cursor-pointer cursor-pointer"
        />

        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

        {preview && (
          <div className="border rounded-lg dark:border-white/10 overflow-hidden mb-4">
            <div className="max-h-72 overflow-y-auto divide-y divide-black/5 dark:divide-white/10">
              {preview.map((row, i) => (
                <div key={i} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate">
                      Row {row.rowNumber} · {row.kind} · <span className="text-zinc-500">{row.identifier}</span>
                    </div>
                    {row.errors.length > 0 && (
                      <ul className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                        {row.errors.map((e, j) => (
                          <li key={j}>{e}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${ACTION_STYLES[row.action]}`}>
                    {row.action}
                  </span>
                </div>
              ))}
            </div>
            <div className="px-3 py-2 text-xs text-zinc-500 border-t dark:border-white/10">
              {importable} row{importable === 1 ? "" : "s"} will be imported
              {rejected > 0 ? `, ${rejected} rejected (won't be written)` : ""}.
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {!preview ? (
            <Button type="button" variant="primary" onClick={handlePreview} disabled={!file || busy}>
              {busy ? "Reading…" : "Preview"}
            </Button>
          ) : (
            <Button type="button" variant="primary" onClick={handleConfirm} disabled={busy || importable === 0}>
              {busy ? "Importing…" : `Confirm import (${importable})`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
