"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { getShop, updateShop } from "@/lib/api";
import type { ProductDisplayOrientation } from "@/lib/types";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Checkbox from "@/components/ui/Checkbox";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import PageShell from "@/components/ui/PageShell";
import { useToast } from "@/components/ui/Toast";

// Storefront > Display: the three presentation settings that used to sit in
// Store Configuration (audit §14.3 P9). Everything else presentational lives
// in the theme builder; these have no theme-builder equivalent yet.
export default function StorefrontDisplayPage() {
  const [loaded, setLoaded] = useState(false);
  const [productDisplayOrientation, setProductDisplayOrientation] = useState<ProductDisplayOrientation>("grid");
  const [productImageZoomEnabled, setProductImageZoomEnabled] = useState(true);
  const [showCollectionMenu, setShowCollectionMenu] = useState(true);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    getShop().then((s) => {
      setProductDisplayOrientation(s.productDisplayOrientation);
      setProductImageZoomEnabled(s.productImageZoomEnabled);
      setShowCollectionMenu(s.showCollectionMenu);
      setLoaded(true);
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await updateShop({ productDisplayOrientation, productImageZoomEnabled, showCollectionMenu });
      toast("Display settings saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save display settings", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <p className="text-sm text-text-muted">Loading…</p>;

  return (
    <PageShell>
      <div className="space-y-4">
        <Card>
          <h3 className="text-[15px] font-bold text-text-primary dark:text-zinc-50 mb-3">Storefront Display</h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-text-secondary dark:text-zinc-400 block mb-1.5">
                Product Display Orientation
              </label>
              <SegmentedToggle
                value={productDisplayOrientation}
                onChange={setProductDisplayOrientation}
                options={[
                  { value: "grid", label: "Grid" },
                  { value: "list", label: "List" },
                ]}
              />
            </div>
            <div className="space-y-2">
              <Checkbox
                label="Product image zoom on detail view"
                checked={productImageZoomEnabled}
                onChange={(e) => setProductImageZoomEnabled(e.target.checked)}
              />
              <Checkbox
                label="Show collection menu"
                checked={showCollectionMenu}
                onChange={(e) => setShowCollectionMenu(e.target.checked)}
              />
            </div>
          </div>
        </Card>
        <Button variant="primary" onClick={handleSave} disabled={saving} loading={saving} className="w-fit">
          <Check className="size-4 inline -mt-0.5 mr-1" />
          Save changes
        </Button>
      </div>
    </PageShell>
  );
}
