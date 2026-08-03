"use client";

import { useState } from "react";
import { addOrderNote } from "@/lib/api";
import type { OrderNote } from "@/lib/types";
import Button from "@/components/ui/Button";
import Textarea from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";

// Staff-only note thread — reused by both order-viewing surfaces
// (OrderDetailModal and the standalone /orders/[id] page) so the two never
// drift into separate implementations of the same feature.
export default function OrderNotesSection({
  orderId,
  notes,
  onAdded,
}: {
  orderId: number;
  notes: OrderNote[];
  onAdded: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await addOrderNote(orderId, draft.trim());
      setDraft("");
      onAdded();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to add note", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="border rounded-lg p-4 dark:border-white/10">
      <h3 className="font-medium mb-3">
        Internal notes
        <span className="ml-1.5 text-xs font-normal text-zinc-400">staff-only, never shown to the customer</span>
      </h3>

      <div className="flex gap-2 mb-3">
        <Textarea
          label="Note"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Leave a note for other staff…"
          rows={2}
          className="flex-1"
        />
        <Button variant="secondary" size="sm" onClick={handleAdd} disabled={saving || !draft.trim()}>
          Add
        </Button>
      </div>

      {notes.length === 0 ? (
        <p className="text-xs text-zinc-400">No notes yet.</p>
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <div key={n.id} className="text-sm border-t pt-2 dark:border-white/10 first:border-t-0 first:pt-0">
              <p className="whitespace-pre-wrap">{n.note}</p>
              <p className="text-xs text-zinc-400 mt-1">
                {n.author.name} · {new Date(n.createdAt).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
