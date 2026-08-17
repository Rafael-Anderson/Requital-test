"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { deleteDeliveryZone, listDeliveryZones, updateDeliveryZone } from "@/lib/api";
import type { DeliveryZone } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import Button from "@/components/ui/Button";
import DeliveryZoneFormModal from "@/components/DeliveryZoneFormModal";
import { useToast } from "@/components/ui/Toast";

export default function OutletDeliveryAreaTab({ outletId }: { outletId: number }) {
  const [zones, setZones] = useState<DeliveryZone[] | null>(null);
  const [editingZone, setEditingZone] = useState<DeliveryZone | null | "new">(null);
  const toast = useToast();

  const refresh = useCallback(async () => {
    setZones(await listDeliveryZones(outletId));
  }, [outletId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleToggleStatus(zone: DeliveryZone) {
    try {
      await updateDeliveryZone(outletId, zone.id, { isActive: !zone.isActive });
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update zone", "error");
    }
  }

  async function handleDelete(zone: DeliveryZone) {
    if (!confirm(`Delete zone "${zone.name}"?`)) return;
    try {
      await deleteDeliveryZone(outletId, zone.id);
      toast(`"${zone.name}" deleted`);
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete zone", "error");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold">Delivery Zones</h3>
          <p className="text-xs text-text-faint mt-0.5">
            Flat-fee named areas, additive to the radius set on the Delivery tab.
          </p>
        </div>
        <Button variant="primary" onClick={() => setEditingZone("new")}>
          <Plus className="size-4 inline -mt-0.5 mr-1" />
          New Zone
        </Button>
      </div>

      <Table>
        <THead>
          <tr>
            <TH>Status</TH>
            <TH>Name</TH>
            <TH>Delivery Fee</TH>
            <TH>Minimum Order Amount</TH>
            <TH></TH>
            <TH></TH>
          </tr>
        </THead>
        <TBody>
          {zones === null ? (
            <tr>
              <td colSpan={6}>
                <TableSkeleton rows={3} cols={6} />
              </td>
            </tr>
          ) : zones.length === 0 ? (
            <tr>
              <td colSpan={6} className="text-center text-sm text-text-faint py-8">
                No delivery zones yet
              </td>
            </tr>
          ) : (
            zones.map((z) => (
              <TR key={z.id}>
                <TD>
                  <button
                    onClick={() => handleToggleStatus(z)}
                    className={`text-xs rounded-full px-2.5 py-1 font-medium border transition-colors cursor-pointer ${
                      z.isActive
                        ? "border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400"
                        : "border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400"
                    }`}
                  >
                    {z.isActive ? "On" : "Off"}
                  </button>
                </TD>
                <TD className="font-medium">{z.name}</TD>
                <TD className="text-text-muted">{z.fee} AED</TD>
                <TD className="text-text-muted">{z.minOrderAmount} AED</TD>
                <TD>
                  <button
                    onClick={() => setEditingZone(z)}
                    className="text-xs underline decoration-transparent hover:decoration-current"
                  >
                    Edit
                  </button>
                </TD>
                <TD>
                  <button
                    onClick={() => handleDelete(z)}
                    className="text-xs text-red-600 dark:text-red-400 underline decoration-transparent hover:decoration-current"
                  >
                    Delete
                  </button>
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      {editingZone && (
        <DeliveryZoneFormModal
          outletId={outletId}
          zone={editingZone === "new" ? null : editingZone}
          onClose={() => setEditingZone(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
