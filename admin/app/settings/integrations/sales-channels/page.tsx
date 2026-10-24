"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import {
  deleteChannelConnection,
  getChannelAvailability,
  listChannelConnections,
  listChannelProviders,
  listOutlets,
  requestChannelVerification,
  setChannelConnectionEnabled,
  testChannelConnection,
  updateChannelConnection,
} from "@/lib/api";
import { providerLabel } from "@/lib/channels";
import type { ChannelAvailability, ChannelConnection, ChannelProviderInfo, Outlet } from "@/lib/types";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import LoadFailed from "@/components/ui/LoadFailed";
import Modal from "@/components/ui/Modal";
import PageShell from "@/components/ui/PageShell";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import SettingsContentSkeleton, { SettingsLoadFailed } from "@/components/SettingsContentSkeleton";
import ConnectionCard from "@/components/channels/ConnectionCard";
import AvailabilityModal from "@/components/channels/AvailabilityModal";
import ConnectionFormModal from "@/components/channels/ConnectionFormModal";
import UnmappedItemsQueue from "@/components/channels/UnmappedItemsQueue";

// Settings > Integrations > Sales channels. Off by default: until the platform
// switches the feature on for the shop (and the shop has no connection yet) this
// page asks the server one question and shows a calm "not available" state; it
// loads nothing else and offers nothing to configure.
export default function SalesChannelsPage() {
  const toast = useToast();
  const [availability, setAvailability] = useState<ChannelAvailability | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [availabilityKey, setAvailabilityKey] = useState(0);

  useEffect(() => {
    let live = true;
    getChannelAvailability()
      .then((a) => {
        if (!live) return;
        setAvailability(a);
        setAvailabilityError(null);
      })
      .catch((err) => {
        if (live) setAvailabilityError(err instanceof Error ? err.message : "Failed to load sales channels");
      });
    return () => {
      live = false;
    };
  }, [availabilityKey]);

  if (availability === null) {
    return availabilityError ? (
      <SettingsLoadFailed what="sales channels" onRetry={() => { setAvailabilityError(null); setAvailabilityKey((k) => k + 1); }} />
    ) : (
      <SettingsContentSkeleton cards={2} fieldsPerCard={2} />
    );
  }

  if (!availability.enabled && !availability.hasConnections) {
    return (
      <PageShell>
        <Card>
          <h3 className="mb-1 text-[15px] font-bold text-text-primary dark:text-zinc-50">Sales channels are not available for your shop yet</h3>
          <p className="text-[13px] text-text-secondary dark:text-zinc-300">
            Taking Deliveroo and Talabat orders in Requital is being rolled out shop by shop. Nothing changes for your store until it
            is switched on for you.
          </p>
        </Card>
      </PageShell>
    );
  }

  return <Channels flagOn={availability.enabled} toast={toast} />;
}

function Channels({ flagOn, toast }: { flagOn: boolean; toast: (m: string, t?: "error") => void }) {
  const [connections, setConnections] = useState<ChannelConnection[] | null>(null);
  const [providers, setProviders] = useState<ChannelProviderInfo[] | null>(null);
  const [outlets, setOutlets] = useState<Outlet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formFor, setFormFor] = useState<ChannelConnection | "new" | null>(null);
  const [deleting, setDeleting] = useState<ChannelConnection | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [checkingId, setCheckingId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);
  const [requestingId, setRequestingId] = useState<number | null>(null);
  const [askAuto, setAskAuto] = useState<ChannelConnection | null>(null);
  const [availabilityFor, setAvailabilityFor] = useState<ChannelConnection | null>(null);

  // Three independent reads: a slow or failed one never keeps the others hidden.
  const latest = useRef(0);
  const load = useCallback(() => {
    const mine = ++latest.current;
    const fail = (err: unknown) => {
      if (mine === latest.current) setError(err instanceof Error ? err.message : "Failed to load sales channels");
    };
    listChannelConnections().then((r) => mine === latest.current && (setConnections(r), setError(null)), fail);
    listChannelProviders().then((r) => mine === latest.current && setProviders(r), fail);
    listOutlets().then((r) => mine === latest.current && setOutlets(r), fail);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const replace = (saved: ChannelConnection) =>
    setConnections((list) => (list ? (list.some((c) => c.id === saved.id) ? list.map((c) => (c.id === saved.id ? saved : c)) : [...list, saved]) : [saved]));

  async function toggle(c: ChannelConnection, next: boolean) {
    setBusyId(c.id);
    setRowError(null);
    if (next) setCheckingId(c.id);
    try {
      replace(await setChannelConnectionEnabled(c.id, next));
      toast(next ? "Connection is on. New orders will arrive in Orders, Marketplace." : "Connection turned off");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not change the connection";
      setRowError({ id: c.id, message });
      // The failed check is recorded server-side (last problem), so refresh the row.
      listChannelConnections().then(setConnections, () => undefined);
    } finally {
      setBusyId(null);
      setCheckingId(null);
    }
  }

  async function test(c: ChannelConnection) {
    setBusyId(c.id);
    setRowError(null);
    try {
      const r = await testChannelConnection(c.id);
      toast(r.ok ? "Connection test passed" : (r.message ?? "Connection test failed"), r.ok ? undefined : "error");
      listChannelConnections().then(setConnections, () => undefined);
    } catch (err) {
      setRowError({ id: c.id, message: err instanceof Error ? err.message : "Connection test failed" });
    } finally {
      setBusyId(null);
    }
  }

  async function requestVerification(c: ChannelConnection) {
    setRequestingId(c.id);
    setRowError(null);
    try {
      replace(await requestChannelVerification(c.id));
      toast("Requested. Requital will confirm your location with the marketplace.");
    } catch (err) {
      setRowError({ id: c.id, message: err instanceof Error ? err.message : "Could not send the request" });
    } finally {
      setRequestingId(null);
    }
  }

  // Turning automatic confirmation ON asks first (it is a commitment to prepare);
  // turning it off does not.
  async function setAuto(c: ChannelConnection, next: boolean) {
    setBusyId(c.id);
    setRowError(null);
    try {
      replace(await updateChannelConnection(c.id, { autoConfirmScheduled: next }));
      toast(next ? "Scheduled orders will be confirmed automatically" : "Automatic confirmation is off");
      setAskAuto(null);
    } catch (err) {
      setRowError({ id: c.id, message: err instanceof Error ? err.message : "Could not change the setting" });
      setAskAuto(null);
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteChannelConnection(deleting.id);
      setConnections((list) => (list ?? []).filter((c) => c.id !== deleting.id));
      toast("Connection deleted");
      setDeleting(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete the connection");
    } finally {
      setDeleteBusy(false);
    }
  }

  const ready = connections !== null && providers !== null && outlets !== null;
  const canAdd = flagOn && ready && providers.length > 0;

  return (
    <PageShell>
      <div className="space-y-4">
        {!flagOn && (
          <Card>
            <p className="text-sm text-text-secondary dark:text-zinc-300">
              <span className="font-semibold">New connections are paused for your shop.</span> Connections you already have keep
              receiving orders, and you can turn them off. Adding or turning on a connection is not available right now.
            </p>
          </Card>
        )}

        <Card>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50">Connections</h3>
            <Button
              variant="primary"
              size="sm"
              className="ms-auto"
              disabled={!canAdd}
              onClick={() => setFormFor("new")}
              title={!flagOn ? "Marketplace channels are not available for your shop yet." : undefined}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Add connection
            </Button>
          </div>
          <p className="mb-4 text-xs text-text-faint">
            One connection links one outlet to one marketplace. Orders from the marketplace arrive in{" "}
            <Link href="/orders/marketplace" className="font-semibold text-accent-text hover:underline dark:text-accent">
              Orders, Marketplace
            </Link>{" "}
            and wait there for you to accept them. The marketplace takes the customer&apos;s payment, so Requital never charges them.
            Connections are always off until you turn them on.
          </p>

          {error && !ready ? (
            <LoadFailed what="sales channels" onRetry={load} />
          ) : !ready ? (
            <div aria-busy="true" aria-label="Loading connections" className="space-y-3">
              <CardSkeleton />
              <CardSkeleton />
            </div>
          ) : connections.length === 0 ? (
            <EmptyState
              title="No sales channels connected"
              description="Add a connection, enter the ids and credentials from the marketplace's partner portal, then ask to be verified. Requital confirms your location with the marketplace before it can be turned on."
            />
          ) : (
            <div className="space-y-3">
              {connections.map((c) => (
                <ConnectionCard
                  key={c.id}
                  connection={c}
                  provider={providers.find((p) => p.name === c.provider)}
                  providers={providers}
                  outlet={outlets.find((o) => o.id === c.outletId)}
                  flagOn={flagOn}
                  busy={busyId === c.id}
                  checking={checkingId === c.id}
                  error={rowError?.id === c.id ? rowError.message : null}
                  onToggle={toggle}
                  onTest={test}
                  onEdit={setFormFor}
                  requestingVerification={requestingId === c.id}
                  onRequestVerification={requestVerification}
                  onAutoConfirm={(x, next) => (next ? setAskAuto(x) : void setAuto(x, false))}
                  onAvailability={setAvailabilityFor}
                  onDelete={(x) => {
                    setDeleteError(null);
                    setDeleting(x);
                  }}
                />
              ))}
            </div>
          )}
        </Card>

        {providers && <UnmappedItemsQueue providers={providers} />}

        <Card>
          <h3 className="mb-1 text-[15px] font-bold text-text-primary dark:text-zinc-50">How marketplace orders work</h3>
          <ul className="list-disc space-y-1.5 ps-5 text-[13px] text-text-secondary dark:text-zinc-300">
            <li>The marketplace collects payment and reports the totals. Requital keeps the marketplace&apos;s prices and never re-prices an order.</li>
            <li>No messages are sent to the customer. Marketplace customers are not added to your customer list.</li>
            <li>
              A new order waits for you to accept it before the marketplace&apos;s deadline. You get a WhatsApp alert at the outlet&apos;s
              number, the same alert channel used for storefront orders; there is nothing extra to switch on. Requital does not check that
              the number is a WhatsApp account.
            </li>
            <li>Stock is held for the order as soon as it arrives and released if it is rejected or cancelled.</li>
          </ul>
        </Card>
      </div>

      {formFor !== null && providers && outlets && connections && (
        <ConnectionFormModal
          connection={formFor === "new" ? null : formFor}
          providers={providers}
          outlets={outlets}
          existing={connections}
          onClose={() => setFormFor(null)}
          onSaved={(saved) => {
            replace(saved);
            toast(formFor === "new" ? "Connection added. It is off until you turn it on." : "Connection saved");
          }}
        />
      )}

      {availabilityFor && providers && (
        <AvailabilityModal connection={availabilityFor} providers={providers} onClose={() => setAvailabilityFor(null)} />
      )}

      {askAuto && (
        <Modal size="sm" title="Confirm scheduled orders automatically?" onClose={() => setAskAuto(null)}>
          {(requestClose) => (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary dark:text-zinc-300">
                Requital will confirm accepted scheduled {providerLabel(askAuto.provider, providers ?? undefined)} orders for you,
                shortly before the marketplace&apos;s deadline. Confirming tells the marketplace you will prepare the order, so only
                turn this on if you are happy to prepare every scheduled order you accept. You can turn it off at any time.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={requestClose}>
                  Keep it off
                </Button>
                <Button variant="primary" loading={busyId === askAuto.id} onClick={() => void setAuto(askAuto, true)}>
                  Turn on
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {deleting && (
        <Modal size="sm" title="Delete this connection?" onClose={() => setDeleting(null)}>
          {(requestClose) => (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary dark:text-zinc-300">
                This removes the {providerLabel(deleting.provider, providers ?? undefined)} connection for{" "}
                {outlets?.find((o) => o.id === deleting.outletId)?.name ?? "this outlet"}, including its saved credentials. It cannot be
                undone. A connection that has received marketplace orders cannot be deleted; turn it off instead.
              </p>
              {deleteError && <InlineErrorMessage>{deleteError}</InlineErrorMessage>}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={requestClose}>
                  Keep connection
                </Button>
                <Button variant="danger" loading={deleteBusy} onClick={confirmDelete}>
                  Delete connection
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </PageShell>
  );
}
