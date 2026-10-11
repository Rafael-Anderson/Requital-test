"use client";

import { useEffect, useState } from "react";
import { listCustomerMerges } from "@/lib/api";
import type { CustomerMergeRecord } from "@/lib/types";
import Card from "@/components/ui/Card";
import LoadFailed from "@/components/ui/LoadFailed";

// What was folded into this customer, by whom and when. Hidden when nothing was.
export default function MergeHistoryCard({ customerId, reloadKey }: { customerId: number; reloadKey: number }) {
  const [records, setRecords] = useState<CustomerMergeRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    listCustomerMerges(customerId)
      .then((d) => live && setRecords(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [customerId, reloadKey, tick]);

  if (failed && records === null) {
    return (
      <Card>
        <LoadFailed what="merge history" onRetry={() => { setFailed(false); setTick((t) => t + 1); }} />
      </Card>
    );
  }
  if (!records || records.length === 0) return null;
  return (
    <Card>
      <h2 className="mb-3 font-medium">Merged customers</h2>
      <ul className="space-y-2 text-sm">
        {records.map((r) => (
          <li key={r.id}>
            {r.duplicateName ?? "Customer"} {r.duplicatePhone ? `(${r.duplicatePhone})` : ""}
            <span className="block text-xs text-text-faint">
              {new Date(r.createdAt).toLocaleString()}
              {r.actorName ? ` by ${r.actorName}` : ""} · {r.moved.orders ?? 0} order(s) moved
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
