"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { acceptChannelOrder, listChannelOrders, rejectChannelOrder } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useOutletFilter } from "@/lib/outlet-context";
import { marketplaceDeskVisible, useChannelAvailability } from "@/lib/useChannelAvailability";
import { providerLabel } from "@/lib/channels";
import type { ChannelOrder } from "@/lib/types";
import BackButton from "@/components/ui/BackButton";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import LoadFailed from "@/components/ui/LoadFailed";
import Modal from "@/components/ui/Modal";
import PageShell from "@/components/ui/PageShell";
import { CardSkeleton } from "@/components/ui/Skeleton";
import Input from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import BranchBar from "@/components/BranchBar";
import OrdersTabs from "@/components/OrdersTabs";
import ChannelOrderCard from "@/components/channels/ChannelOrderCard";

// A minute is long next to a seven-minute acceptance window.
const POLL_INTERVAL_MS = 15_000;

export default function MarketplaceOrdersPage() {
  const { user } = useAuth();
  const availability = useChannelAvailability();
  const { selectedOutletId, outlets } = useOutletFilter();
  const toast = useToast();
  const [orders, setOrders] = useState<ChannelOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<ChannelOrder | null>(null);
  const [reason, setReason] = useState("");
  const visible = marketplaceDeskVisible(availability);

  const latest = useRef(0);
  const refresh = useCallback(() => {
    const mine = ++latest.current;
    // ponytail: one page of 100, newest first. Fine for a desk that is worked
    // through all day; add paging if a shop ever has more than 100 open ones.
    listChannelOrders({ pageSize: 100, outletId: selectedOutletId ?? undefined })
      .then((r) => {
        if (mine !== latest.current) return;
        setOrders(r.data);
        setError(null);
      })
      .catch((err) => {
        if (mine !== latest.current) return;
        setError(err instanceof Error ? err.message : "Failed to load marketplace orders");
      });
  }, [selectedOutletId]);

  useEffect(() => {
    if (!visible) return;
    refresh();
    const t = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [visible, refresh]);

  async function act(order: ChannelOrder, kind: "accept" | "reject", why?: string) {
    setBusyId(order.id);
    setActionError(null);
    try {
      if (kind === "accept") await acceptChannelOrder(order.id);
      else await rejectChannelOrder(order.id, why);
      toast(kind === "accept" ? "Order accepted" : "Order rejected");
      setRejecting(null);
      setReason("");
      refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "The marketplace did not answer. Nothing was changed.";
      setActionError(msg);
      toast(msg, "error");
    } finally {
      setBusyId(null);
    }
  }

  const outletName = useMemo(() => new Map(outlets.map((o) => [o.id, o.name])), [outlets]);
  const waiting = (orders ?? [])
    .filter((o) => o.state === "pending_acceptance")
    .sort((a, b) => (a.acceptBy ?? "9999").localeCompare(b.acceptBy ?? "9999"));
  const mapping = (orders ?? []).filter((o) => o.state === "needs_mapping");
  const rest = (orders ?? []).filter((o) => o.state !== "pending_acceptance" && o.state !== "needs_mapping");
  const isAdmin = user?.role === "admin";

  const card = (o: ChannelOrder) => (
    <ChannelOrderCard
      key={o.id}
      order={o}
      outletName={outletName.get(o.outletId)}
      isAdmin={isAdmin}
      busy={busyId === o.id}
      onAccept={(x) => act(x, "accept")}
      onReject={(x) => {
        setActionError(null);
        setRejecting(x);
      }}
    />
  );

  return (
    <PageShell>
      <BranchBar left={<BackButton href="/" />} />
      <h1 className="mb-[18px] text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50">Orders</h1>
      <OrdersTabs />

      {availability === undefined ? (
        <div aria-busy="true" aria-label="Loading marketplace orders" className="grid gap-3 md:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : !visible ? (
        <EmptyState
          title="Marketplace orders are not available for your shop yet"
          description="When Deliveroo or Talabat orders are switched on for your shop, they will appear here."
        />
      ) : (
        <div className="space-y-6">
          {actionError && !rejecting && <InlineErrorMessage>{actionError}</InlineErrorMessage>}
          {error && orders !== null && <InlineErrorMessage>{error}</InlineErrorMessage>}
          {orders === null ? (
            error ? (
              <LoadFailed what="marketplace orders" onRetry={refresh} />
            ) : (
              <div aria-busy="true" aria-label="Loading marketplace orders" className="grid gap-3 md:grid-cols-2">
                <CardSkeleton />
                <CardSkeleton />
              </div>
            )
          ) : orders.length === 0 ? (
            <EmptyState
              title="No marketplace orders yet"
              description={
                isAdmin
                  ? "Orders from your connected marketplaces show up here the moment they arrive, and you accept them here."
                  : "Orders from your connected marketplaces show up here the moment they arrive."
              }
            />
          ) : (
            <>
              <section aria-labelledby="mk-waiting">
                <h2 id="mk-waiting" className="mb-2 text-[15px] font-bold text-text-primary dark:text-zinc-50">
                  Waiting for you ({waiting.length})
                </h2>
                {waiting.length === 0 ? (
                  <p className="text-[13px] text-text-muted">Nothing is waiting. New marketplace orders appear here with their deadline.</p>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">{waiting.map(card)}</div>
                )}
              </section>
              {mapping.length > 0 && (
                <section aria-labelledby="mk-mapping">
                  <h2 id="mk-mapping" className="mb-2 text-[15px] font-bold text-text-primary dark:text-zinc-50">
                    Needs item mapping ({mapping.length})
                  </h2>
                  <div className="grid gap-3 md:grid-cols-2">{mapping.map(card)}</div>
                </section>
              )}
              {rest.length > 0 && (
                <section aria-labelledby="mk-recent">
                  <h2 id="mk-recent" className="mb-2 text-[15px] font-bold text-text-primary dark:text-zinc-50">
                    Recent
                  </h2>
                  <div className="grid gap-3 md:grid-cols-2">{rest.map(card)}</div>
                </section>
              )}
            </>
          )}
          {isAdmin && (
            <p className="text-[12.5px] text-text-faint">
              Connections, credentials and item mappings are in{" "}
              <Link href="/settings/integrations/sales-channels" className="font-semibold text-accent-text hover:underline dark:text-accent">
                Settings, Sales channels
              </Link>
              .
            </p>
          )}
        </div>
      )}

      {rejecting && (
        <Modal
          size="sm"
          title={`Reject ${providerLabel(rejecting.provider)} order ${rejecting.displayId ?? rejecting.externalOrderId}?`}
          onClose={() => setRejecting(null)}
        >
          {(requestClose) => (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(rejecting, "reject", reason.trim() || undefined);
              }}
              className="space-y-4"
            >
              <p className="text-sm text-text-secondary dark:text-zinc-300">
                The marketplace is told the order is rejected and any stock held for it is released. This cannot be undone.
              </p>
              <Input
                label="Reason (optional)"
                maxLength={200}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="For example: item sold out"
              />
              {actionError && <InlineErrorMessage>{actionError}</InlineErrorMessage>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={requestClose}>
                  Keep order
                </Button>
                <Button type="submit" variant="danger" loading={busyId === rejecting.id}>
                  Reject order
                </Button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </PageShell>
  );
}
