"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listChannelUnmappedItems, listProducts, resolveChannelUnmappedItem } from "@/lib/api";
import { providerLabel } from "@/lib/channels";
import { relativeTime } from "@/lib/format";
import type { ChannelProviderInfo, ChannelUnmappedItem, Product } from "@/lib/types";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Combobox from "@/components/ui/Combobox";
import EmptyState from "@/components/ui/EmptyState";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import LoadFailed from "@/components/ui/LoadFailed";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { AcceptDeadline } from "@/components/channels/ChannelBadges";

function hasVariantChoice(p: Product | undefined): boolean {
  return !!p && (p.hasVariants || p.options.length > 0);
}

function Row({
  item,
  products,
  providers,
  onSaved,
}: {
  item: ChannelUnmappedItem;
  products: Product[] | null;
  providers: ChannelProviderInfo[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const product = products?.find((p) => String(p.id) === productId);
  const needsVariant = hasVariantChoice(product);
  const ready = !!product && (!needsVariant || !!variantId);

  async function save() {
    if (!product) return;
    setSaving(true);
    setError(null);
    try {
      const r = await resolveChannelUnmappedItem(item.id, {
        productId: product.id,
        ...(needsVariant ? { variantId: Number(variantId) } : {}),
      });
      toast(
        r.ordersCreated > 0
          ? `Linked. ${r.ordersCreated} ${r.ordersCreated === 1 ? "order is" : "orders are"} now waiting for you to accept.`
          : "Linked. Future orders with this item will match automatically.",
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the link");
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="rounded-2xl border border-border bg-surface p-4 dark:border-white/10 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-bold text-text-primary dark:text-zinc-50">{item.externalName ?? item.externalItemId}</span>
        <span className="text-xs text-text-faint">
          {providerLabel(item.provider, providers)} item <span className="font-mono">{item.externalItemId}</span>
        </span>
        <span className="text-xs text-text-faint">
          Seen {item.occurrences} {item.occurrences === 1 ? "time" : "times"}, last {relativeTime(item.lastSeenAt)}
        </span>
      </div>

      {item.waitingOrders.length > 0 && (
        <div className="mt-2 rounded-xl bg-warning-bg p-3 text-[13px] text-warning-text dark:bg-amber-500/10 dark:text-amber-300">
          <p className="font-semibold">
            {item.waitingOrders.length} {item.waitingOrders.length === 1 ? "order is" : "orders are"} waiting on this item
          </p>
          <ul className="mt-1 space-y-1">
            {item.waitingOrders.map((w) => (
              <li key={w.channelOrderId} className="flex flex-wrap items-center gap-x-3">
                <span>Order #{w.displayId ?? w.externalOrderId}</span>
                {w.acceptBy && <AcceptDeadline acceptBy={w.acceptBy} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_1fr_auto]">
        <Combobox
          label="Your product"
          ariaLabel="Your product"
          value={productId}
          onChange={(v) => {
            setProductId(v);
            setVariantId("");
          }}
          options={(products ?? []).map((p) => ({ value: String(p.id), label: p.sku ? `${p.name} (${p.sku})` : p.name }))}
          placeholder={products === null ? "Loading products..." : "Choose a product"}
          searchPlaceholder="Search products"
          emptyText="No products match"
        />
        {needsVariant ? (
          <Combobox
            label="Variant"
            ariaLabel="Variant"
            value={variantId}
            onChange={setVariantId}
            options={(product?.variants ?? []).map((v) => ({ value: String(v.id), label: v.label ?? v.sku ?? `Variant ${v.id}` }))}
            placeholder="Choose a variant"
            searchPlaceholder="Search variants"
          />
        ) : (
          <div className="hidden md:block" />
        )}
        <Button variant="primary" onClick={save} loading={saving} disabled={!ready}>
          {error ? "Retry" : "Save link"}
        </Button>
      </div>
      {error && <InlineErrorMessage className="mt-3">{error}</InlineErrorMessage>}
    </li>
  );
}

// Marketplace items Requital has seen on an order but cannot match to a product.
// The merchant decides what each one is; nothing is ever created for them. An
// order that contains an unmapped item stays visible (Orders, Marketplace) with
// its deadline and moves on the moment the last item is linked.
export default function UnmappedItemsQueue({
  providers,
  onChanged,
}: {
  providers: ChannelProviderInfo[];
  // Lets the page refresh anything else that depends on the queue.
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<ChannelUnmappedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [productsError, setProductsError] = useState<string | null>(null);
  const latest = useRef(0);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const mine = ++latest.current;
    listChannelUnmappedItems()
      .then((r) => {
        if (mine !== latest.current) return;
        setItems(r);
        setError(null);
      })
      .catch((err) => {
        if (mine !== latest.current) return;
        setError(err instanceof Error ? err.message : "Failed to load unmapped items");
      });
  }, [reloadKey]);

  // The catalogue is only fetched once there is something to map.
  const needProducts = (items?.length ?? 0) > 0;
  useEffect(() => {
    if (!needProducts || products !== null) return;
    let live = true;
    listProducts()
      .then((p) => {
        if (live) setProducts(p);
      })
      .catch((err) => {
        if (live) setProductsError(err instanceof Error ? err.message : "Failed to load products");
      });
    return () => {
      live = false;
    };
  }, [needProducts, products]);

  const reload = useCallback(() => {
    setReloadKey((k) => k + 1);
    onChanged?.();
  }, [onChanged]);

  return (
    <Card id="unmapped" className="scroll-mt-4">
      <h3 className="mb-1 text-[15px] font-bold text-text-primary dark:text-zinc-50">Items waiting to be linked</h3>
      <p className="mb-4 text-xs text-text-faint">
        When a marketplace order contains an item Requital does not recognise, the order is held and listed here. Orders with
        unlinked items stay visible under Orders, Marketplace, with their deadline. Nothing is created for you: you choose which
        of your products each marketplace item is, and once the last item is linked the order moves on to &quot;Waiting for you to
        accept&quot;.
      </p>
      {items === null ? (
        error ? (
          <LoadFailed what="unmapped items" onRetry={() => setReloadKey((k) => k + 1)} />
        ) : (
          <div aria-busy="true" aria-label="Loading unmapped items">
            <CardSkeleton />
          </div>
        )
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing is waiting to be linked"
          description="Items you have not linked yet will appear here the first time they arrive on an order."
        />
      ) : (
        <>
          {productsError && <InlineErrorMessage className="mb-3">{productsError}</InlineErrorMessage>}
          <ul className="space-y-3">
            {items.map((i) => (
              <Row key={i.id} item={i} products={products} providers={providers} onSaved={reload} />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
