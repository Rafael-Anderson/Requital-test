"use client";

import { useCallback, useEffect, useState } from "react";
import { listOutlets, updateOutletStatus } from "@/lib/api";
import type { Outlet } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import Toggle from "@/components/ui/Toggle";
import BackButton from "@/components/ui/BackButton";
import BranchBar from "@/components/BranchBar";
import OrdersTabs from "@/components/OrdersTabs";
import PageShell from "@/components/ui/PageShell";
import { useToast } from "@/components/ui/Toast";

// Small "is this outlet accepting X orders" badge — green when enabled,
// neutral gray when not (never red: "not accepting pickup right now" isn't
// a broken/error state, matching Toggle.tsx's own documented off-state
// convention elsewhere in this app).
function StatusPill({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`text-xs rounded-full px-2.5 py-1 font-medium border ${
        enabled
          ? "border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400"
          : "border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-zinc-800 text-text-muted"
      }`}
    >
      {enabled ? "On" : "Off"}
    </span>
  );
}

// Lets staff without settings access toggle a branch's accepting-orders
// state without granting them the full Settings > Outlets permission tier
// — see PATCH /outlets/:id/status, a narrow sibling of the full outlet
// update endpoint. Nothing else configurable here: zones, hours, and
// addresses all stay in Settings.
export default function BranchStatusPage() {
  const [outlets, setOutlets] = useState<Outlet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      setOutlets(await listOutlets());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load outlets");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleToggle(outlet: Outlet, field: "pickupEnabled" | "deliveryEnabled", next: boolean) {
    setSavingId(outlet.id);
    setOutlets((prev) => prev?.map((o) => (o.id === outlet.id ? { ...o, [field]: next } : o)) ?? prev);
    try {
      await updateOutletStatus(outlet.id, { [field]: next });
    } catch (err) {
      setOutlets((prev) => prev?.map((o) => (o.id === outlet.id ? { ...o, [field]: !next } : o)) ?? prev);
      toast(err instanceof Error ? err.message : "Failed to update outlet status", "error");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <PageShell>
      <BranchBar left={<BackButton href="/orders" />} />
      <h1 className="text-2xl font-semibold mb-1">Branch Status</h1>
      <OrdersTabs />

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <Table>
        <THead>
          <tr>
            <TH>Name</TH>
            <TH>Pickup</TH>
            <TH>Delivery</TH>
            <TH>Accepting Pickup Orders</TH>
            <TH>Accepting Delivery Orders</TH>
          </tr>
        </THead>
        <TBody>
          {outlets === null ? (
            <tr>
              <td colSpan={5}>
                <TableSkeleton rows={4} cols={5} />
              </td>
            </tr>
          ) : outlets.length === 0 ? (
            <tr>
              <td colSpan={5} className="text-center text-sm text-text-faint py-8">
                No outlets yet
              </td>
            </tr>
          ) : (
            outlets.map((outlet) => (
              <TR key={outlet.id}>
                <TD className="font-medium">{outlet.name}</TD>
                <TD>
                  <StatusPill enabled={outlet.pickupEnabled} />
                </TD>
                <TD>
                  <StatusPill enabled={outlet.deliveryEnabled} />
                </TD>
                <TD>
                  <Toggle
                    checked={outlet.pickupEnabled}
                    disabled={savingId === outlet.id}
                    onChange={(next) => handleToggle(outlet, "pickupEnabled", next)}
                  />
                </TD>
                <TD>
                  <Toggle
                    checked={outlet.deliveryEnabled}
                    disabled={savingId === outlet.id}
                    onChange={(next) => handleToggle(outlet, "deliveryEnabled", next)}
                  />
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>
    </PageShell>
  );
}
