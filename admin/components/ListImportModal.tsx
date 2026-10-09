"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";

export interface ListImportRow {
  rowNumber: number;
  title: string;
  subtitle?: string | null;
  action: string;
  reason: string | null;
  details: string[];
  warnings: string[];
  errors: string[];
}

export interface ListImportReport {
  summary: string;
  note?: string | null;
  warnings: string[];
  rows: ListImportRow[];
  truncated: boolean;
  writable: number;
}

const ACTION_STYLES: Record<string, string> = {
  create: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  update: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  skip: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  conflict: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

function Row({ row }: { row: ListImportRow }) {
  const hasDetail =
    row.reason ||
    row.details.length > 0 ||
    row.warnings.length > 0 ||
    row.errors.length > 0;
  return (
    <details className="px-3 py-2 text-sm">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">
            {row.title || `Row ${row.rowNumber}`}
          </div>
          <div className="text-xs text-text-muted">
            Row {row.rowNumber}
            {row.subtitle ? ` - ${row.subtitle}` : ""}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${ACTION_STYLES[row.action] ?? ACTION_STYLES.skip}`}
        >
          {row.action}
        </span>
      </summary>
      {hasDetail && (
        <div className="mt-2 space-y-2 ps-1">
          {row.reason && (
            <p className="text-xs text-text-muted">{row.reason}</p>
          )}
          {row.errors.length > 0 && (
            <ul className="text-xs text-red-600 dark:text-red-400">
              {row.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          {row.details.length > 0 && (
            <ul className="text-xs">
              {row.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
          {row.warnings.length > 0 && (
            <ul className="text-xs text-amber-700 dark:text-amber-400">
              {row.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </details>
  );
}

// The shared preview/confirm wizard for the list-shaped imports (collections,
// customers). Same stateless contract as CsvImportModal: preview writes
// nothing; confirm re-uploads the same file and the server re-plans it.
export default function ListImportModal({
  title,
  intro,
  existingLabel,
  previewFn,
  confirmFn,
  onClose,
  onImported,
}: {
  title: string;
  intro: string;
  existingLabel: string;
  previewFn: (
    file: File,
    onExisting: "update" | "skip",
  ) => Promise<ListImportReport>;
  confirmFn: (file: File, onExisting: "update" | "skip") => Promise<string>;
  onClose: () => void;
  onImported: () => void;
}) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [onExisting, setOnExisting] = useState<"update" | "skip">("skip");
  const [report, setReport] = useState<ListImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function invalidate() {
    setReport(null);
    setError(null);
  }

  async function handlePreview() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setReport(await previewFn(file, onExisting));
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
      toast(await confirmFn(file, onExisting));
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
      title={title}
      footer={(requestClose) => (
        <>
          <Button type="button" variant="secondary" onClick={requestClose}>
            Cancel
          </Button>
          {!report ? (
            <Button
              type="button"
              variant="primary"
              onClick={handlePreview}
              disabled={!file || busy}
              loading={busy}
            >
              {busy ? "Reading..." : "Preview"}
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              onClick={handleConfirm}
              disabled={busy || report.writable === 0}
              loading={busy}
            >
              {busy ? "Importing..." : `Confirm import (${report.writable})`}
            </Button>
          )}
        </>
      )}
    >
      <p className="text-sm text-text-muted -mt-2 mb-4">
        {intro} Nothing is saved until you review the preview and confirm.
      </p>

      <input
        type="file"
        accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          invalidate();
        }}
        className="block w-full text-sm mb-4 file:me-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-black/5 dark:file:bg-white/10 file:text-sm file:cursor-pointer cursor-pointer"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <Select
          label={existingLabel}
          value={onExisting}
          onChange={(e) => {
            setOnExisting(e.target.value === "update" ? "update" : "skip");
            invalidate();
          }}
        >
          <option value="skip">Leave them alone</option>
          <option value="update">Fill in what is missing</option>
        </Select>
      </div>

      {error && (
        <InlineErrorMessage className="mb-3">{error}</InlineErrorMessage>
      )}

      {report && (
        <div className="space-y-3 mb-4">
          <p className="text-sm">{report.summary}</p>
          {report.note && (
            <p className="text-xs text-text-muted">{report.note}</p>
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
              {report.rows.map((r) => (
                <Row key={r.rowNumber} row={r} />
              ))}
            </div>
            {report.truncated && (
              <div className="px-3 py-2 text-xs text-text-muted border-t border-gray-200 dark:border-white/10">
                Showing the first rows only. Errors are listed first. The counts
                above cover the whole file.
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
