"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { createDeliveryRun, listDrivers, listReadyOrders } from "@/lib/api";
import {
  PROOF_REQUIREMENT_LABELS,
  type Driver,
  type ProofRequirement,
  type ReadyOrder,
} from "@/lib/types";
import { useOutletFilter } from "@/lib/outlet-context";
import { useAuth } from "@/lib/auth-context";
import { formatMoney } from "@/lib/money";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Input from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import LoadFailed from "@/components/ui/LoadFailed";
import EmptyState from "@/components/ui/EmptyState";
import BackButton from "@/components/ui/BackButton";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import PageShell from "@/components/ui/PageShell";
import { useToast } from "@/components/ui/Toast";

function addressOf(o: ReadyOrder) {
  return [o.customerAddress, o.area, o.regionName].filter(Boolean).join(", ");
}

export default function NewDeliveryRunPage() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const { selectedOutletId, outlets } = useOutletFilter();
  const [outletId, setOutletId] = useState<number | null>(selectedOutletId);
  const effectiveOutletId = user?.role === "branch" ? user.outletId : (outletId ?? outlets[0]?.id ?? null);

  const [drivers, setDrivers] = useState<Driver[] | null>(null);
  const [ready, setReady] = useState<ReadyOrder[] | null>(null);
  const [driversError, setDriversError] = useState(false);
  const [readyError, setReadyError] = useState(false);
  const [driverId, setDriverId] = useState<number | "">("");
  const [proof, setProof] = useState<ProofRequirement>("photo_or_otp");
  const [runDate, setRunDate] = useState("");
  const [notes, setNotes] = useState("");
  // The run, in stop order. Reordered with the arrows (works with touch too).
  const [picked, setPicked] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Two independent loads with their own stale-response guard: a slow or failed
  // one never holds the other's result back.
  const latestDrivers = useRef(0);
  useEffect(() => {
    if (effectiveOutletId === null) return;
    const mine = ++latestDrivers.current;
    listDrivers({ outletId: effectiveOutletId, active: true })
      .then((r) => {
        if (mine !== latestDrivers.current) return;
        setDrivers(r);
        setDriversError(false);
      })
      .catch(() => {
        if (mine === latestDrivers.current) setDriversError(true);
      });
  }, [effectiveOutletId, reloadKey]);

  const latestReady = useRef(0);
  useEffect(() => {
    if (effectiveOutletId === null) return;
    const mine = ++latestReady.current;
    listReadyOrders(effectiveOutletId)
      .then((r) => {
        if (mine !== latestReady.current) return;
        setReady(r);
        setReadyError(false);
      })
      .catch(() => {
        if (mine === latestReady.current) setReadyError(true);
      });
  }, [effectiveOutletId, reloadKey]);

  function changeOutlet(id: number) {
    setOutletId(id);
    setDrivers(null);
    setReady(null);
    setPicked([]);
    setDriverId("");
  }

  const byId = new Map((ready ?? []).map((o) => [o.id, o]));
  const available = (ready ?? []).filter((o) => !picked.includes(o.id));

  function move(index: number, delta: -1 | 1) {
    const next = [...picked];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setPicked(next);
  }

  async function create() {
    if (driverId === "" || picked.length === 0 || effectiveOutletId === null) return;
    setSaving(true);
    setError(null);
    try {
      const run = await createDeliveryRun({
        outletId: effectiveOutletId,
        driverId,
        proofRequirement: proof,
        orderIds: picked,
        ...(runDate ? { runDate } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      toast("Run created. Review it, then dispatch.");
      router.push(`/orders/runs/${run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the run");
      setSaving(false);
    }
  }

  return (
    <PageShell>
      <BackButton href="/orders/runs" />
      <h1 className="mb-4 mt-3 text-2xl font-semibold">New delivery run</h1>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-4 lg:col-span-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {user?.role === "admin" && (
              <Select label="Outlet" value={effectiveOutletId ?? ""} onChange={(e) => changeOutlet(Number(e.target.value))}>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            )}
            <Select label="Driver" value={driverId} onChange={(e) => setDriverId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Choose a driver</option>
              {(drivers ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <Select
              label="Proof of delivery"
              value={proof}
              onChange={(e) => setProof(e.target.value as ProofRequirement)}
            >
              {(Object.keys(PROOF_REQUIREMENT_LABELS) as ProofRequirement[]).map((p) => (
                <option key={p} value={p}>
                  {PROOF_REQUIREMENT_LABELS[p]}
                </option>
              ))}
            </Select>
            <Input label="Date" type="date" value={runDate} onChange={(e) => setRunDate(e.target.value)} />
          </div>
          <Input label="Notes for the driver" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          {driversError && <LoadFailed what="drivers" onRetry={() => setReloadKey((k) => k + 1)} />}
          {drivers !== null && drivers.length === 0 && (
            <p className="text-sm text-text-muted">No active drivers at this outlet. Add one under Drivers first.</p>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-base font-semibold">Ready orders</h2>
          {readyError ? (
            <LoadFailed what="ready orders" onRetry={() => setReloadKey((k) => k + 1)} />
          ) : ready === null ? (
            <p className="text-sm text-text-muted">Loading...</p>
          ) : available.length === 0 ? (
            <EmptyState title="Nothing waiting" description="Delivery orders that are being prepared appear here." />
          ) : (
            <ul className="space-y-2">
              {available.map((o) => (
                <li key={o.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-2.5 dark:border-white/10">
                  <div className="min-w-0 text-sm">
                    <div className="font-medium">
                      #{o.shopOrderNumber} {o.customerName}
                    </div>
                    <div className="truncate text-xs text-text-muted">{addressOf(o)}</div>
                    <div className="text-xs text-text-faint">
                      {formatMoney(o.total, o.currency)}
                      {o.paymentMethod === "cash_on_delivery" && " (cash on delivery)"}
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setPicked([...picked, o.id])}>
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-base font-semibold">Stops, in order ({picked.length})</h2>
          {picked.length === 0 ? (
            <p className="text-sm text-text-muted">Add orders from the list. Use the arrows to set the order of the drive.</p>
          ) : (
            <ol className="space-y-2">
              {picked.map((id, i) => {
                const o = byId.get(id);
                return (
                  <li key={id} className="flex items-center gap-2 rounded-lg border border-border p-2.5 dark:border-white/10">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">{i + 1}</span>
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="truncate font-medium">
                        #{o?.shopOrderNumber ?? id} {o?.customerName}
                      </div>
                      <div className="truncate text-xs text-text-muted">{o ? addressOf(o) : ""}</div>
                    </div>
                    <button type="button" aria-label="Move up" disabled={i === 0} className="rounded p-1.5 hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10" onClick={() => move(i, -1)}>
                      <ArrowUp className="size-4" />
                    </button>
                    <button type="button" aria-label="Move down" disabled={i === picked.length - 1} className="rounded p-1.5 hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10" onClick={() => move(i, 1)}>
                      <ArrowDown className="size-4" />
                    </button>
                    <button type="button" aria-label="Remove from run" className="rounded p-1.5 hover:bg-black/5 dark:hover:bg-white/10" onClick={() => setPicked(picked.filter((x) => x !== id))}>
                      <X className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>

      {error && <InlineErrorMessage className="mt-3">{error}</InlineErrorMessage>}
      <div className="mt-4 flex justify-end">
        <Button variant="primary" loading={saving} disabled={saving || driverId === "" || picked.length === 0} onClick={() => void create()}>
          Create run
        </Button>
      </div>
    </PageShell>
  );
}
