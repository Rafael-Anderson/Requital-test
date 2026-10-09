"use client";

import { useState } from "react";
import { assignCustomerTags, unassignCustomerTags } from "@/lib/api";
import type { CustomerTagWithCount } from "@/lib/types";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";

// Bulk tag assign / remove for the selected rows (CUS-2). One request each way;
// the server rejects the whole call if any id is not in the caller's shop.
export default function CustomerTagBulkControls({
  customerIds,
  tags,
  onDone,
}: {
  customerIds: number[];
  tags: CustomerTagWithCount[];
  onDone: () => void;
}) {
  const toast = useToast();
  const [tagId, setTagId] = useState("");
  const [busy, setBusy] = useState(false);

  async function apply(mode: "add" | "remove") {
    if (!tagId) return;
    setBusy(true);
    try {
      const fn = mode === "add" ? assignCustomerTags : unassignCustomerTags;
      await fn(customerIds, [Number(tagId)]);
      toast(mode === "add" ? "Tag added" : "Tag removed");
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update tags", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-44">
        <Select value={tagId} onChange={(e) => setTagId(e.target.value)} aria-label="Tag to apply">
          <option value="">Choose a tag</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </div>
      <Button size="sm" variant="secondary" disabled={!tagId || busy} onClick={() => void apply("add")}>
        Add tag
      </Button>
      <Button size="sm" variant="secondary" disabled={!tagId || busy} onClick={() => void apply("remove")}>
        Remove tag
      </Button>
    </div>
  );
}
