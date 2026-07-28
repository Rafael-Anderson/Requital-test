"use client";

import { useState } from "react";
import { X, ZoomIn } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { iconStyleProps } from "@/lib/icon-style";

// Baymard's product-page research treats a real gallery (multiple angles +
// a genuinely usable zoom) as close to non-negotiable — a shopper can't
// touch the product, so the photos are doing all the work a showroom would.
// Hover-zoom here is a plain CSS transform following the cursor (no new
// dependency); mobile has no hover, so tapping opens the same image full-
// screen instead. Gallery selection is controlled by the parent
// (ProductDetailClient) rather than owned here, since a variant with its
// own photo needs to drive which image is active from outside this component.
export default function ProductGallery({
  images,
  activeIndex,
  onActiveIndexChange,
  productName,
  zoomEnabled,
}: {
  images: string[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  productName: string;
  zoomEnabled: boolean;
}) {
  const { shop } = useShop();
  const [zoomed, setZoomed] = useState(false);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const active = images[activeIndex] ?? images[0];

  return (
    <div>
      <div
        className={`relative aspect-square rounded-xl overflow-hidden bg-black/5 ${zoomEnabled ? "cursor-zoom-in" : ""}`}
        onMouseMove={(e) => {
          if (!zoomEnabled) return;
          const rect = e.currentTarget.getBoundingClientRect();
          setHoverPos({ x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 });
        }}
        onMouseLeave={() => setHoverPos(null)}
        onClick={() => zoomEnabled && setZoomed(true)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={active}
          alt={productName}
          className="w-full h-full object-cover transition-transform duration-150 ease-out"
          style={hoverPos ? { transform: "scale(1.7)", transformOrigin: `${hoverPos.x}% ${hoverPos.y}%` } : undefined}
        />
        {zoomEnabled && (
          <span className="absolute bottom-3 right-3 flex items-center justify-center size-8 rounded-full bg-white/90 text-zinc-700 pointer-events-none sm:hidden">
            <ZoomIn className="size-4" {...iconStyleProps(shop?.iconStyle, 2)} />
          </span>
        )}
      </div>

      {images.length > 1 && (
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          {images.map((url, i) => (
            <button
              key={`${url}-${i}`}
              type="button"
              onClick={() => onActiveIndexChange(i)}
              aria-label={`View image ${i + 1}`}
              aria-current={i === activeIndex}
              className={`shrink-0 size-16 rounded-lg overflow-hidden border-2 transition-colors cursor-pointer ${
                i === activeIndex ? "border-accent" : "border-transparent hover:border-black/15"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {zoomed && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6"
          onClick={() => setZoomed(false)}
        >
          <button
            type="button"
            onClick={() => setZoomed(false)}
            className="absolute top-4 right-4 text-white cursor-pointer"
            aria-label="Close"
          >
            <X className="size-6" {...iconStyleProps(shop?.iconStyle, 2)} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={active}
            alt={productName}
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
