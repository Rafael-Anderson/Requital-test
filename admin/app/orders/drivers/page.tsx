"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Pencil, UserX } from "lucide-react";
import { createDriver, deleteDriver, listDrivers, updateDriver } from "@/lib/api";
import type { Driver } from "@/lib/types";
import { useOutletFilter } from "@/lib/outlet-context";
import { useAuth } from "@/lib/auth-context";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import LoadFailed from "@/components/ui/LoadFailed";
import { CardList, CardListItem, CardListSkeleton } from "@/components/ui/CardList";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Toggle from "@/components/ui/Toggle";
import Modal from "@/components/ui/Modal";
import BackButton from "@/components/ui/BackButton";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import BranchBar from "@/components/BranchBar";
import PageShell from "@/components/ui/PageShell";
import { useToast } from "@/components/ui/Toast";

function DriverModal({
  driver,
  defaultOutletId,
  onClose,
  onSaved,
}: {
  driver: Driver | null;
  defaultOutletId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const { outlets } = useOutletFilter();
  const toast = useToast();
  const [name, setName] = useState(driver?.name ?? "");
  const [phone, setPhone] = useState(driver?.phone ?? "");
  const [outletId, setOutletId] = useState<number | "">(defaultOutletId ?? outlets[0]?.id ?? "");
  const [active, setActive] = useState(driver?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(requestClose: () => void) {
    setSaving(true);
    setError(null);
    try {
      if (driver) {
        await updateDriver(driver.id, { name, phone, active });
      } else {
        await createDriver({ name, phone, ...(user?.role === "admin" && outletId ? { outletId } : {}) });
      }
      toast(driver ? "Driver saved" : "Driver added");
      onSaved();
      requestClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the driver");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} size="sm" title={driver ? "Edit driver" : "Add driver"}>
      {(requestClose) => (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save(requestClose);
          }}
        >
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          <Input label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          {!driver && user?.role === "admin" && (
            <Select label="Outlet" value={outletId} onChange={(e) => setOutletId(Number(e.target.value))}>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          )}
          {driver && (
            <label className="flex items-center gap-3 text-sm">
              <Toggle checked={active} onChange={setActive} />
              Active (an inactive driver cannot be given runs and their links stop working)
            </label>
          )}
          {error && <InlineErrorMessage>{error}</InlineErrorMessage>}
          <div className="sticky bottom-0 flex justify-end gap-2 bg-surface pt-2 dark:bg-zinc-900">
            <Button type="button" variant="secondary" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={saving} disabled={saving}>
              Save
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default function DriversPage() {
  const { selectedOutletId, outlets } = useOutletFilter();
  const toast = useToast();
  const [drivers, setDrivers] = useState<Driver[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Driver | "new" | null>(null);

  const latest = useRef(0);
  const refresh = useCallback(() => {
    const mine = ++latest.current;
    listDrivers({ outletId: selectedOutletId })
      .then((result) => {
        if (mine !== latest.current) return;
        setDrivers(result);
        setError(null);
      })
      .catch((err) => {
        if (mine !== latest.current) return;
        setError(err instanceof Error ? err.message : "Failed to load drivers");
      });
  }, [selectedOutletId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const outletName = (id: number) => outlets.find((o) => o.id === id)?.name ?? `Outlet ${id}`;

  function remove(d: Driver) {
    if (!window.confirm(`Remove ${d.name}? A driver with delivery history is deactivated instead.`)) return;
    deleteDriver(d.id)
      .then((r) => {
        toast(r.deleted ? "Driver removed" : "Driver deactivated (they have delivery history)");
        refresh();
      })
      .catch((err) => toast(err instanceof Error ? err.message : "Could not remove the driver", "error"));
  }

  const placeholder =
    drivers === null && error ? (
      <LoadFailed what="drivers" onRetry={refresh} />
    ) : drivers !== null && drivers.length === 0 && !error ? (
      <EmptyState title="No drivers yet" description="Add the people who deliver for you, then give them a run." />
    ) : null;

  return (
    <PageShell>
      <BranchBar left={<BackButton href="/orders/runs" />} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Drivers</h1>
        <Button variant="primary" onClick={() => setEditing("new")}>
          <Plus className="-mt-0.5 me-1 inline size-4" />
          Add driver
        </Button>
      </div>

      {drivers === null && !error ? (
        <CardListSkeleton rows={4} selectable={false} />
      ) : placeholder ? (
        <div className="rounded-2xl border border-border bg-surface md:hidden dark:border-white/10 dark:bg-zinc-900">{placeholder}</div>
      ) : (
        <CardList>
          {(drivers ?? []).map((d) => (
            <CardListItem key={d.id} onOpen={() => setEditing(d)} openLabel={`Edit ${d.name}`}>
              <div className="truncate text-sm font-semibold">{d.name}</div>
              <div className="truncate text-xs text-text-muted">{d.phone}</div>
              <div className="text-xs text-text-faint">
                {outletName(d.outletId)}
                {!d.active && " (inactive)"}
              </div>
            </CardListItem>
          ))}
        </CardList>
      )}

      <Table className="hidden md:block">
        <THead>
          <tr>
            <TH>Name</TH>
            <TH>Phone</TH>
            <TH>Outlet</TH>
            <TH className="w-24">Status</TH>
            <TH className="w-24" />
          </tr>
        </THead>
        <TBody>
          {drivers === null && !error ? (
            <tr>
              <td colSpan={5}>
                <TableSkeleton rows={4} cols={5} />
              </td>
            </tr>
          ) : placeholder ? (
            <tr>
              <td colSpan={5}>{placeholder}</td>
            </tr>
          ) : (
            (drivers ?? []).map((d) => (
              <TR key={d.id}>
                <TD className="font-medium">{d.name}</TD>
                <TD>{d.phone}</TD>
                <TD className="text-text-muted">{outletName(d.outletId)}</TD>
                <TD className={d.active ? "text-green-600 dark:text-green-400" : "text-text-faint"}>{d.active ? "Active" : "Inactive"}</TD>
                <TD>
                  <div className="flex justify-end gap-1">
                    <button type="button" aria-label={`Edit ${d.name}`} className="rounded p-1.5 hover:bg-black/5 dark:hover:bg-white/10" onClick={() => setEditing(d)}>
                      <Pencil className="size-4" />
                    </button>
                    <button type="button" aria-label={`Remove ${d.name}`} className="rounded p-1.5 hover:bg-black/5 dark:hover:bg-white/10" onClick={() => remove(d)}>
                      <UserX className="size-4" />
                    </button>
                  </div>
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      {editing && (
        <DriverModal
          driver={editing === "new" ? null : editing}
          defaultOutletId={selectedOutletId}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </PageShell>
  );
}
