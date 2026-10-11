"use client";

import { useEffect, useState } from "react";
import { listCustomers, mergeCustomers, previewCustomerMerge } from "@/lib/api";
import type { CustomerListItem, CustomerMergePreview } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Checkbox from "@/components/ui/Checkbox";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import { useToast } from "@/components/ui/Toast";

const MAX_DUPLICATES = 5;

// CUS-10. Pick the customers that are really this one, review what will move,
// type MERGE. The merge cannot be undone, so the confirmation is typed, not
// clicked, and the server insists on the same word.
export default function MergeCustomersModal({
  primaryId,
  primaryName,
  onClose,
  onMerged,
}: {
  primaryId: number;
  primaryName: string;
  onClose: () => void;
  onMerged: () => void;
}) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerListItem[] | null>(null);
  const [searchFailed, setSearchFailed] = useState(false);
  const [picked, setPicked] = useState<CustomerListItem[]>([]);
  const [preview, setPreview] = useState<CustomerMergePreview | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      listCustomers({ search: term, pageSize: 10 })
        .then((r) => {
          if (!live) return;
          setSearchFailed(false);
          setResults(r.data.filter((c) => c.id !== primaryId));
        })
        .catch(() => live && setSearchFailed(true));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, primaryId]);

  const toggle = (c: CustomerListItem) => {
    setPreview(null);
    setPicked((cur) => (cur.some((p) => p.id === c.id) ? cur.filter((p) => p.id !== c.id) : cur.length >= MAX_DUPLICATES ? cur : [...cur, c]));
  };

  async function runPreview() {
    setError(null);
    try {
      setPreview(await previewCustomerMerge(primaryId, picked.map((p) => p.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not preview the merge");
    }
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await mergeCustomers(primaryId, picked.map((p) => p.id));
      toast("Customers merged");
      onMerged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The merge failed. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} size="md" title={`Merge into ${primaryName}`}>
      {(requestClose) => (
        <div className="space-y-4">
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            This cannot be undone. The customers you pick are removed; their orders, store credit, notes, tags and consent history
            move to {primaryName}. {primaryName} keeps their own name and phone number.
          </p>
          <Input
            label="Find customers to merge in (name or phone)"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value.trim().length < 2) setResults(null);
            }}
          />
          {searchFailed && <InlineErrorMessage>Search failed. Try again.</InlineErrorMessage>}
          {results && results.length === 0 && <p className="text-xs text-text-faint">No other customers match.</p>}
          {results && results.length > 0 && (
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {results.map((c) => (
                <li key={c.id}>
                  <Checkbox
                    label={`${c.name} · ${c.phone} · ${c.orderCount} order${c.orderCount === 1 ? "" : "s"}`}
                    checked={picked.some((p) => p.id === c.id)}
                    onChange={() => toggle(c)}
                  />
                </li>
              ))}
            </ul>
          )}
          {picked.length > 0 && (
            <p className="text-sm">
              Selected: {picked.map((p) => p.name).join(", ")} ({picked.length}/{MAX_DUPLICATES})
            </p>
          )}
          {preview && (
            <div className="rounded-lg border border-border p-3 text-sm dark:border-white/10">
              Will move {preview.willMove.orders} order(s), {preview.willMove.draftOrders} draft order(s),{" "}
              {preview.willMove.storeCreditEntries} store credit entr{preview.willMove.storeCreditEntries === 1 ? "y" : "ies"} and{" "}
              {preview.willMove.notes} note(s).
              {preview.customers.some((c) => c.registered && c.id !== primaryId) && (
                <p className="mt-1 text-red-700">A selected customer has a storefront account and cannot be merged in.</p>
              )}
            </div>
          )}
          {error && <InlineErrorMessage>{error}</InlineErrorMessage>}
          {preview && (
            <Input label="Type MERGE to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={requestClose}>
              Cancel
            </Button>
            {!preview ? (
              <Button disabled={picked.length === 0} onClick={() => void runPreview()}>
                Review
              </Button>
            ) : (
              <Button loading={busy} disabled={busy || typed !== "MERGE"} onClick={() => void run()}>
                Merge customers
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
