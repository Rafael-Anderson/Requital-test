"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { getShop, updateShop } from "@/lib/api";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import LoadFailed from "@/components/ui/LoadFailed";
import Checkbox from "@/components/ui/Checkbox";
import { useToast } from "@/components/ui/Toast";

// Same-day / next-day ordering, moved here from an outlet's Basic Info tab
// ("Order Setting"). It used to be saved in one payload with the tax fields;
// those moved to Selling > Money & Tax, so this card saves just its own two.
export default function OrderDatesCard() {
  const [loaded, setLoaded] = useState(false);
  const [allowSameDayOrders, setAllowSameDayOrders] = useState(true);
  const [allowNextDayOrders, setAllowNextDayOrders] = useState(true);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  // A failed load ends in an error with Try again, not a card that silently never appears.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let live = true;
    getShop()
      .then((s) => {
        if (!live) return;
        setAllowSameDayOrders(s.allowSameDayOrders);
        setAllowNextDayOrders(s.allowNextDayOrders);
        setLoadError(null);
        setLoaded(true);
      })
      .catch((err) => {
        if (live) setLoadError(err instanceof Error ? err.message : "Failed to load order dates");
      });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  async function handleSave() {
    setSaving(true);
    try {
      await updateShop({ allowSameDayOrders, allowNextDayOrders });
      toast("Order dates saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save order dates", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return loadError ? (
      <Card>
        <LoadFailed
          what="order dates"
          onRetry={() => {
            setLoadError(null);
            setReloadKey((k) => k + 1);
          }}
        />
      </Card>
    ) : null;
  }

  return (
    <Card>
      <h3 className="text-sm font-semibold mb-1">Order Dates</h3>
      <p className="text-xs text-text-faint mb-4">These apply to every outlet.</p>
      <p className="text-sm font-medium text-text-secondary dark:text-zinc-400 mb-2">
        Select the dates customers can place orders for
      </p>
      <div className="space-y-2 mb-4">
        <Checkbox
          label="Same-day orders"
          checked={allowSameDayOrders}
          onChange={(e) => setAllowSameDayOrders(e.target.checked)}
        />
        <Checkbox
          label="Next-day orders"
          checked={allowNextDayOrders}
          onChange={(e) => setAllowNextDayOrders(e.target.checked)}
        />
      </div>
      <Button variant="primary" onClick={handleSave} disabled={saving} loading={saving} className="w-fit">
        <Check className="size-4 inline -mt-0.5 me-1" />
        Save changes
      </Button>
    </Card>
  );
}
