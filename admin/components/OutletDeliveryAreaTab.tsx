"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { deleteDeliveryZone, getRegions, getZoneMappingProposal, listDeliveryZones, updateDeliveryZone } from "@/lib/api";
import type { DeliveryZone, RegionsResponse, ZoneMappingProposal } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import Button from "@/components/ui/Button";
import DeliveryZoneFormModal from "@/components/DeliveryZoneFormModal";
import ZoneRegionsModal from "@/components/ZoneRegionsModal";
import { useToast } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/money";
import { useShopCurrency } from "@/lib/useShopCurrency";

export default function OutletDeliveryAreaTab({ outletId }: { outletId: number }) {
  const currency = useShopCurrency();
  const [zones, setZones] = useState<DeliveryZone[] | null>(null);
  const [editingZone, setEditingZone] = useState<DeliveryZone | null | "new">(null);
  const [reviewingZone, setReviewingZone] = useState<DeliveryZone | null>(null);
  const [proposal, setProposal] = useState<ZoneMappingProposal | null>(null);
  const [regionsRes, setRegionsRes] = useState<RegionsResponse | null>(null);
  const toast = useToast();
  const regions = regionsRes?.regions ?? [];
  const regionLabel = regionsRes?.country?.regionLabel ?? "Region";

  const refresh = useCallback(async () => {
    const [list, prop] = await Promise.all([listDeliveryZones(outletId), getZoneMappingProposal(outletId)]);
    setZones(list);
    setProposal(prop);
  }, [outletId]);

  useEffect(() => {
    getRegions()
      .then(setRegionsRes)
      .catch(() => setRegionsRes(null));
  }, []);

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
        <h3 className="text-sm font-semibold">Delivery Zones</h3>
        <Button variant="primary" onClick={() => setEditingZone("new")}>
          <Plus className="size-4 inline -mt-0.5 me-1" />
          New Zone
        </Button>
      </div>

      {proposal?.mode === "legacy" && (
        <div className="mb-4 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <p className="font-medium">Your delivery zones are still matched by name</p>
          <p>
            Zones now match by the {regionLabel.toLowerCase()}s they cover, which is more reliable than comparing names. Nothing
            changes for your customers until every active zone has been reviewed ({proposal.unconfirmedActiveZones} left).
            Open each one marked &ldquo;Needs review&rdquo; and confirm its {regionLabel.toLowerCase()}s.
          </p>
        </div>
      )}

      <Table>
        <THead>
          <tr>
            <TH>Status</TH>
            <TH>Name</TH>
            <TH>{regionLabel}s</TH>
            <TH>Delivery Fee</TH>
            <TH>Minimum Order Amount</TH>
            <TH></TH>
            <TH></TH>
            <TH></TH>
          </tr>
        </THead>
        <TBody>
          {zones === null ? (
            <tr>
              <td colSpan={8}>
                <TableSkeleton rows={3} cols={8} />
              </td>
            </tr>
          ) : zones.length === 0 ? (
            <tr>
              <td colSpan={8} className="text-center text-sm text-text-faint py-8">
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
                <TD className="text-text-muted">
                  {z.regions && z.regions.length > 0 ? z.regions.map((r) => r.nameEn).join(", ") : "-"}
                  {z.mappingConfirmedAt ? null : (
                    <span className="ms-2 text-xs rounded-full px-2 py-0.5 border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400">
                      Needs review
                    </span>
                  )}
                </TD>
                <TD className="text-text-muted">{formatMoney(z.fee, currency)}</TD>
                <TD className="text-text-muted">
                  {formatMoney(z.minOrderAmount, currency)}
                </TD>
                <TD>
                  {!z.mappingConfirmedAt && regions.length > 0 && (
                    <button
                      onClick={() => setReviewingZone(z)}
                      className="text-xs underline decoration-transparent hover:decoration-current"
                    >
                      Review
                    </button>
                  )}
                </TD>
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
          regions={regions}
          regionLabel={regionLabel}
          onClose={() => setEditingZone(null)}
          onSaved={refresh}
        />
      )}
      {reviewingZone && proposal?.zones.find((p) => p.zoneId === reviewingZone.id) && (
        <ZoneRegionsModal
          outletId={outletId}
          zone={reviewingZone}
          item={proposal.zones.find((p) => p.zoneId === reviewingZone.id)!}
          regions={regions}
          regionLabel={regionLabel}
          onClose={() => setReviewingZone(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
