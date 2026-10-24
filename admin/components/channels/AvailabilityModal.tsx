"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listChannelMappings, setChannelItemAvailability } from "@/lib/api";
import { providerLabel } from "@/lib/channels";
import type { ChannelConnection, ChannelItemMapping, ChannelProviderInfo } from "@/lib/types";
import Button from "@/components/ui/Button";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import LoadFailed from "@/components/ui/LoadFailed";
import Modal from "@/components/ui/Modal";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

// Marks one linked item sold out (or available again) at the marketplace. Each
// press is one request for one item, sent straight away. Requital cannot read the
// marketplace's current state back, so no state is shown. Only items already
// linked to a product can be changed (the server refuses any other id).
export default function AvailabilityModal({
  connection,
  providers,
  onClose,
}: {
  connection: ChannelConnection;
  providers: ChannelProviderInfo[];
  onClose: () => void;
}) {
  const toast = useToast();
  const name = providerLabel(connection.provider, providers);
  const [items, setItems] = useState<ChannelItemMapping[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const latest = useRef(0);
  const load = useCallback(() => {
    const mine = ++latest.current;
    listChannelMappings(connection.provider).then(
      (r) => mine === latest.current && setItems(r),
      () => mine === latest.current && setFailed(true),
    );
  }, [connection.provider]);

  useEffect(() => {
    load();
  }, [load]);

  async function send(item: ChannelItemMapping, available: boolean) {
    const key = `${item.externalItemId}:${available}`;
    setBusyKey(key);
    setError(null);
    try {
      await setChannelItemAvailability(connection.id, [{ externalItemId: item.externalItemId, available }]);
      toast(available ? `${item.productName} is available again at ${name}` : `${item.productName} is marked sold out at ${name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${name} did not accept the change. Nothing was changed.`);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Modal size="md" title={`Item availability at ${name}`} onClose={onClose}>
      {(requestClose) => (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary dark:text-zinc-300">
            Changes are sent to {name} straight away. If {name} refuses, nothing is changed. Requital cannot read the current state
            back from {name}, so check the marketplace app if you are unsure.
          </p>
          {error && <InlineErrorMessage>{error}</InlineErrorMessage>}
          {failed ? (
            <LoadFailed
              what="linked items"
              onRetry={() => {
                setFailed(false);
                load();
              }}
            />
          ) : items === null ? (
            <div aria-busy="true" aria-label="Loading linked items">
              <CardSkeleton />
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-text-muted">No items are linked yet. Link marketplace items to your products first.</p>
          ) : (
            <ul className="divide-y divide-border dark:divide-white/10">
              {items.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="truncate text-sm font-semibold text-text-primary dark:text-zinc-100">{i.productName}</div>
                    <div className="truncate font-mono text-xs text-text-muted">{i.externalName ?? i.externalItemId}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busyKey === `${i.externalItemId}:false`}
                    disabled={busyKey !== null}
                    onClick={() => void send(i, false)}
                    aria-label={`Mark ${i.productName} sold out`}
                  >
                    Sold out
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busyKey === `${i.externalItemId}:true`}
                    disabled={busyKey !== null}
                    onClick={() => void send(i, true)}
                    aria-label={`Mark ${i.productName} available`}
                  >
                    Available
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <Button variant="secondary" onClick={requestClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
