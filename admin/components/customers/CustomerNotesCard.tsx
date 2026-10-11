"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { addCustomerNote, deleteCustomerNote, listCustomerNotes } from "@/lib/api";
import type { CustomerNote } from "@/lib/types";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Textarea from "@/components/ui/Textarea";
import LoadFailed from "@/components/ui/LoadFailed";
import Skeleton from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

// CUS-3. Staff-only notes on a customer: author and time on each, never shown to
// the customer (no storefront route reads them).
export default function CustomerNotesCard({ customerId, canEdit }: { customerId: number; canEdit: boolean }) {
  const toast = useToast();
  const [notes, setNotes] = useState<CustomerNote[] | null>(null);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    listCustomerNotes(customerId)
      .then((d) => live && setNotes(d))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [customerId, tick]);

  async function handleAdd() {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await addCustomerNote(customerId, draft.trim());
      setDraft("");
      setTick((t) => t + 1);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to add note", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteCustomerNote(customerId, id);
      setTick((t) => t + 1);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete note", "error");
    }
  }

  return (
    <Card>
      <h2 className="mb-1 font-medium">Notes</h2>
      <p className="mb-3 text-xs text-text-faint">Staff only. Never shown to the customer.</p>
      {canEdit && (
        <div className="mb-4 space-y-2">
          <Textarea
            label="New note"
            value={draft}
            maxLength={4000}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="Delivery preferences, allergies, anything staff should know"
          />
          <div className="flex justify-end">
            <Button size="sm" variant="secondary" onClick={handleAdd} loading={saving} disabled={saving || !draft.trim()}>
              Add note
            </Button>
          </div>
        </div>
      )}
      {error && notes === null ? (
        <LoadFailed
          what="notes"
          onRetry={() => {
            setError(false);
            setTick((t) => t + 1);
          }}
        />
      ) : notes === null ? (
        <Skeleton className="h-16 w-full" />
      ) : notes.length === 0 ? (
        <p className="text-xs text-text-faint">No notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="border-t border-border pt-2 first:border-t-0 first:pt-0 dark:border-white/10">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 whitespace-pre-wrap break-words text-sm">{n.body}</p>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => void handleDelete(n.id)}
                    aria-label="Delete note"
                    className="shrink-0 cursor-pointer text-text-faint hover:text-red-600"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-text-faint">
                {n.authorName} · {new Date(n.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
