"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { listOutlets, deleteOutlet } from "@/lib/api";
import type { Outlet } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import Button from "@/components/ui/Button";
import StatusBadge from "@/components/StatusBadge";
import OutletFormModal from "@/components/OutletFormModal";
import { useToast } from "@/components/ui/Toast";
import PageShell from "@/components/ui/PageShell";
import Tooltip from "@/components/ui/Tooltip";

function locationLabel(outlet: Outlet): string {
  if (outlet.area && outlet.emirate) return `${outlet.area}, ${outlet.emirate}`;
  return outlet.area ?? outlet.emirate ?? "-";
}

export default function SettingsOutletsPage() {
  const [outlets, setOutlets] = useState<Outlet[] | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const toast = useToast();

  const refresh = useCallback(async () => {
    setOutlets(await listOutlets());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleDelete(outlet: Outlet) {
    if (!confirm(`Delete "${outlet.name}"? This only works if it has no orders or assigned users.`)) return;
    try {
      await deleteOutlet(outlet.id);
      toast(`"${outlet.name}" deleted`);
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete outlet", "error");
    }
  }

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-lg font-bold text-text-primary dark:text-zinc-50">Branches</h2>
        <Button variant="primary" onClick={() => setShowCreateModal(true)}>
          <Plus className="size-4 inline -mt-0.5 mr-1" />
          New outlet
        </Button>
      </div>

      <Table>
        <THead>
          <tr>
            <TH>Name</TH>
            <TH>Status</TH>
            <TH>Location</TH>
            <TH>Delivery</TH>
            <TH>Pickup</TH>
            <TH></TH>
            <TH></TH>
          </tr>
        </THead>
        <TBody>
          {outlets === null ? (
            <tr>
              <td colSpan={7}>
                <TableSkeleton rows={3} cols={7} />
              </td>
            </tr>
          ) : (
            outlets.map((o) => (
              <TR key={o.id}>
                <TD className="font-medium">{o.name}</TD>
                <TD>
                  <StatusBadge status={o.isOpen ? "open" : "closed"} />
                  {o.closedOverride && (
                    <span className="ml-1.5 text-xs text-text-faint">(manual)</span>
                  )}
                </TD>
                <TD className="text-text-muted">{locationLabel(o)}</TD>
                <TD className="text-text-muted">
                  {o.deliveryEnabled ? `Yes · ${o.deliveryRadiusKm ?? "?"}km` : "No"}
                </TD>
                <TD className="text-text-muted">{o.pickupEnabled ? "Yes" : "No"}</TD>
                <TD>
                  <Tooltip label={`Edit ${o.name}`}>
                    <Link
                      href={`/settings/outlets/${o.id}/edit`}
                      className="inline-flex p-1.5 rounded text-text-muted hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                      aria-label={`Edit ${o.name}`}
                    >
                      <Pencil className="size-4" />
                    </Link>
                  </Tooltip>
                </TD>
                <TD>
                  <Tooltip label={`Delete ${o.name}. This cannot be undone.`} align="end">
                    <button
                      onClick={() => handleDelete(o)}
                      className="p-1.5 rounded text-text-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                      aria-label={`Delete ${o.name}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </Tooltip>
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      {showCreateModal && <OutletFormModal onClose={() => setShowCreateModal(false)} />}
    </PageShell>
  );
}
