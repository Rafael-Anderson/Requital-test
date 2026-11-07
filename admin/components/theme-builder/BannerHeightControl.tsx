"use client";

import Input from "@/components/ui/Input";
import { BANNER_HEIGHT_MAX, BANNER_HEIGHT_MIN, parseBannerHeight } from "@/lib/banner-height";

// Height of a banner image in px, one value for desktop and one for mobile. Width is never
// a setting: the image always fills the width (object-fit: cover). The slider and the
// number box edit the same value. `undefined` = never set = the current rendered height.
// The editor preview has no direct-manipulation resize handle (PreviewInteraction only
// selects, edits and reorders), so this panel is the way to change it.
export default function BannerHeightControl({
  label,
  desktop,
  mobile,
  defaultPx,
  onChange,
}: {
  label: string;
  desktop: number | undefined;
  mobile: number | undefined;
  defaultPx: number;
  onChange: (next: { desktop?: number; mobile?: number }) => void;
}) {
  function row(which: "desktop" | "mobile", title: string, value: number | undefined) {
    const shown = value ?? defaultPx;
    return (
      <div className="space-y-1.5">
        <div className="flex items-end gap-3">
          <div className="w-28">
            <Input
              label={title}
              type="number"
              inputMode="numeric"
              min={BANNER_HEIGHT_MIN}
              max={BANNER_HEIGHT_MAX}
              value={value === undefined ? "" : String(value)}
              placeholder={String(defaultPx)}
              onChange={(e) =>
                onChange({
                  desktop: which === "desktop" ? parseBannerHeight(e.target.value) : desktop,
                  mobile: which === "mobile" ? parseBannerHeight(e.target.value) : mobile,
                })
              }
            />
          </div>
          <input
            type="range"
            aria-label={`${label} (${title.toLowerCase()}) slider`}
            className="mb-2 min-w-0 flex-1"
            min={BANNER_HEIGHT_MIN}
            max={BANNER_HEIGHT_MAX}
            step={10}
            value={shown}
            onChange={(e) =>
              onChange({
                desktop: which === "desktop" ? Number(e.target.value) : desktop,
                mobile: which === "mobile" ? Number(e.target.value) : mobile,
              })
            }
          />
          <span className="mb-2 w-12 text-end text-xs text-zinc-500">{shown}px</span>
        </div>
      </div>
    );
  }

  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      {row("desktop", "Desktop (px)", desktop)}
      {row("mobile", "Mobile (px)", mobile)}
      <p className="text-xs text-zinc-500">
        {BANNER_HEIGHT_MIN} to {BANNER_HEIGHT_MAX}px. Leave empty to keep the current height. The image always fills the width.
      </p>
    </fieldset>
  );
}
