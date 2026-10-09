"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { createCustomerTag, deleteCustomerTag, listCustomerTags, updateCustomerTag } from "@/lib/api";
import type { CustomerTagWithCount } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import LoadFailed from "@/components/ui/LoadFailed";
import { useToast } from "@/components/ui/Toast";

// Create, rename and delete the shop's customer tags. Deleting a tag removes it
// from every customer; the customers themselves are untouched.
export default function ManageTagsModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [tags, setTags] = useState<CustomerTagWithCount[] | null>(null);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    listCustomerTags()
      .then((d) => live && setTags(d))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [tick]);

  async function run(action: () => Promise<unknown>, failure: string) {
    setBusy(true);
    try {
      await action();
      setTick((t) => t + 1);
    } catch (err) {
      toast(err instanceof Error ? err.message : failure, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} size="sm" title="Customer tags">
      {() => (
        <div className="space-y-4">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Input label="New tag" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <Button
              size="sm"
              disabled={!newName.trim() || busy}
              onClick={() =>
                void run(async () => {
                  await createCustomerTag({ name: newName.trim() });
                  setNewName("");
                }, "Failed to create tag")
              }
            >
              Create
            </Button>
          </div>
          {error && tags === null ? (
            <LoadFailed
              what="tags"
              onRetry={() => {
                setError(false);
                setTick((t) => t + 1);
              }}
            />
          ) : tags === null ? null : tags.length === 0 ? (
            <p className="text-xs text-text-faint">No tags yet.</p>
          ) : (
            <ul className="space-y-2">
              {tags.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <Input
                      label="Name"
                      defaultValue={t.name}
                      maxLength={60}
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next && next !== t.name) void run(() => updateCustomerTag(t.id, { name: next }), "Failed to rename tag");
                      }}
                    />
                  </div>
                  <span className="shrink-0 text-xs text-text-faint">{t.customerCount}</span>
                  <button
                    type="button"
                    aria-label={`Delete tag ${t.name}`}
                    className="shrink-0 cursor-pointer text-text-faint hover:text-red-600"
                    onClick={() => {
                      if (window.confirm(`Delete the tag "${t.name}"? It is removed from ${t.customerCount} customer(s).`)) {
                        void run(() => deleteCustomerTag(t.id), "Failed to delete tag");
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
