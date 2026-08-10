"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { getShop, storefrontUrlFor } from "@/lib/api";
import type { Outlet, Shop } from "@/lib/types";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

// Outlets don't have their own storefront page (tenant resolution is
// shop-scoped — /[shop]/... — not per-outlet, see CLAUDE.md "Storefront
// frontend"), so this encodes the shop's storefront home URL, same as
// TopBar's "View store" link. Useful for physical signage at this specific
// branch regardless — a customer scans it in-store and lands on the shop.
export default function OutletQrTab({ outlet }: { outlet: Outlet }) {
  const [shop, setShop] = useState<Shop | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getShop().then(setShop);
  }, []);

  function handleDownload() {
    const canvas = canvasRef.current?.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${outlet.name.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}-qr-code.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  if (!shop) return <p className="text-sm text-zinc-500">Loading…</p>;

  const url = storefrontUrlFor(shop);

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-1">Storefront QR Code</h3>
        <p className="text-xs text-zinc-400">
          Scan to open your storefront. Print this for signage at {outlet.name}.
        </p>
      </div>

      {!shop.published && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Your shop isn&apos;t published yet. This code won&apos;t resolve until you publish it.
        </p>
      )}

      <div ref={canvasRef} className="inline-block rounded-lg border border-black/10 dark:border-white/10 p-4 bg-white">
        <QRCodeCanvas value={url} size={200} level="M" marginSize={0} />
      </div>

      <p className="text-xs text-zinc-500 break-all">{url}</p>

      <Button variant="secondary" onClick={handleDownload}>
        <Download className="size-4 inline -mt-0.5 mr-1" />
        Download QR Code
      </Button>
    </Card>
  );
}
