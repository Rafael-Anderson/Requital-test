"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  assignCustomerTags,
  createCustomerTag,
  getCustomerTags,
  listCustomerTags,
  unassignCustomerTags,
} from "@/lib/api";
import type { CustomerTag, CustomerTagWithCount } from "@/lib/types";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import LoadFailed from "@/components/ui/LoadFailed";
import Skeleton from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

export function TagChip({ tag, onRemove }: { tag: CustomerTag; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-medium text-text-secondary dark:border-white/15 dark:bg-zinc-800 dark:text-zinc-200"
      style={tag.color ? { borderColor: tag.color } : undefined}
    >
      {tag.color && <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden />}
      <span className="truncate">{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove tag ${tag.name}`}
          className="cursor-pointer rounded-full text-text-faint hover:text-text-primary"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

// CUS-2. The tags on one customer. The assigned list and the shop's tag list are
// two independent requests, each with its own stale guard, so a failure of one
// never leaves the card on a skeleton.
export default function CustomerTagsCard({ customerId, canEdit }: { customerId: number; canEdit: boolean }) {
  const toast = useToast();
  const [assigned, setAssigned] = useState<CustomerTag[] | null>(null);
  const [all, setAll] = useState<CustomerTagWithCount[] | null>(null);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  const [pick, setPick] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    getCustomerTags(customerId)
      .then((d) => live && setAssigned(d))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [customerId, tick]);

  useEffect(() => {
    let live = true;
    listCustomerTags()
      .then((d) => live && setAll(d))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [tick]);

  const reload = () => setTick((t) => t + 1);

  async function run(action: () => Promise<unknown>, failure: string) {
    setBusy(true);
    try {
      await action();
      reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : failure, "error");
    } finally {
      setBusy(false);
    }
  }

  const available = (all ?? []).filter((t) => !(assigned ?? []).some((a) => a.id === t.id));

  return (
    <Card>
      <h2 className="mb-3 font-medium">Tags</h2>
      {error && assigned === null ? (
        <LoadFailed
          what="tags"
          onRetry={() => {
            setError(false);
            reload();
          }}
        />
      ) : assigned === null ? (
        <Skeleton className="h-8 w-48" />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {assigned.length === 0 && <p className="text-xs text-text-faint">No tags yet.</p>}
            {assigned.map((t) => (
              <TagChip
                key={t.id}
                tag={t}
                onRemove={
                  canEdit ? () => void run(() => unassignCustomerTags([customerId], [t.id]), "Failed to remove tag") : undefined
                }
              />
            ))}
          </div>
          {canEdit && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Select label="Add an existing tag" value={pick} onChange={(e) => setPick(e.target.value)}>
                    <option value="">Choose a tag</option>
                    {available.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!pick || busy}
                  onClick={() =>
                    void run(async () => {
                      await assignCustomerTags([customerId], [Number(pick)]);
                      setPick("");
                    }, "Failed to add tag")
                  }
                >
                  Add
                </Button>
              </div>
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Input label="Or create a new tag" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} />
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!newName.trim() || busy}
                  onClick={() =>
                    void run(async () => {
                      const tag = await createCustomerTag({ name: newName.trim() });
                      await assignCustomerTags([customerId], [tag.id]);
                      setNewName("");
                    }, "Failed to create tag")
                  }
                >
                  Create
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
