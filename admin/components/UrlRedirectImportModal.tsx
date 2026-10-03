"use client";

import { useState } from "react";
import { confirmUrlRedirectImport, previewUrlRedirectImport } from "@/lib/api";
import type { RedirectImportReport, RedirectImportRow } from "@/lib/types";
import Button from "@/components/ui/Button";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

const ACTION_STYLES: Record<RedirectImportRow["action"], string> = {
  create: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  update: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  skip: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

// Preview, then confirm: the same file is uploaded twice and the server
// re-validates it on confirm, so nothing in the preview is trusted.
export default function UrlRedirectImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<RedirectImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const writable = report ? report.created + report.updated : 0;

  async function handlePreview() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setReport(await previewUrlRedirectImport(file));
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
      const result = await confirmUrlRedirectImport(file);
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
      size="md"
      title="Import redirects"
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
      <p className="text-sm text-text-muted -mt-2 mb-2">
        A CSV with the columns <span className="font-mono">from</span>, <span className="font-mono">to</span> and
        optionally <span className="font-mono">status</span> (301 or 302; blank means 301). Shopify&apos;s
        &quot;Redirect from&quot; and &quot;Redirect to&quot; columns work as they are. Nothing is saved until you
        review the preview and confirm.
      </p>
      <p className="text-sm text-text-muted mb-4">
        Targets must be a path on your store or an address on your own store domain.
      </p>

      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setReport(null);
          setError(null);
        }}
        className="block w-full text-sm mb-4 file:me-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-black/5 dark:file:bg-white/10 file:text-sm file:cursor-pointer cursor-pointer"
      />

      {error && <InlineErrorMessage className="mb-3">{error}</InlineErrorMessage>}

      {report && (
        <div className="border border-border rounded-lg dark:border-white/10 overflow-hidden mb-4">
          <div className="px-3 py-2 text-sm border-b border-gray-200 dark:border-white/10">
            {report.created} to create, {report.updated} to update, {report.skipped} unchanged, {report.errors} with
            errors (out of {report.total} rows)
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-black/5 dark:divide-white/10">
            {report.rows.map((row) => (
              <div key={row.rowNumber} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate">
                    Row {row.rowNumber}: <span className="font-mono">{row.from}</span> to{" "}
                    <span className="font-mono">{row.to}</span>
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
          {report.truncated && (
            <div className="px-3 py-2 text-xs text-text-muted border-t border-gray-200 dark:border-white/10">
              Showing the first rows only. Errors are listed first. The counts above cover the whole file.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
