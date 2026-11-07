"use client";

import Button from "@/components/ui/Button";
import Slider from "@/components/ui/Slider";
import { BANNER_HEIGHT_MAX, BANNER_HEIGHT_MIN, clampBannerHeight } from "@/lib/banner-height";

// Banner height (px) for desktop and mobile. Width is never a setting: the image
// always fills the width (object-fit: cover). `desktop` undefined = the banner's
// current default is in effect and nothing is stored.
export default function BannerHeightControl({
  desktop,
  mobile,
  defaultHeight,
  defaultNote,
  onChange,
}: {
  desktop: number | undefined;
  mobile: number | undefined;
  // Pre-fills the slider when a merchant first sets a custom height.
  defaultHeight: number;
  defaultNote: string;
  onChange: (next: { desktop: number | undefined; mobile: number | undefined }) => void;
}) {
  if (desktop === undefined) {
    return (
      <div className="space-y-1.5">
        <span className="block text-sm font-medium">Banner height</span>
        <p className="text-xs text-zinc-500">{defaultNote}</p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onChange({ desktop: clampBannerHeight(defaultHeight), mobile: undefined })}
        >
          Set a custom height
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <Slider
        label="Banner height, desktop"
        suffix="px"
        min={BANNER_HEIGHT_MIN}
        max={BANNER_HEIGHT_MAX}
        step={10}
        value={desktop}
        onChange={(v) => onChange({ desktop: clampBannerHeight(v), mobile })}
      />
      <Slider
        label="Banner height, mobile"
        suffix="px"
        min={BANNER_HEIGHT_MIN}
        max={BANNER_HEIGHT_MAX}
        step={10}
        value={mobile ?? desktop}
        onChange={(v) => onChange({ desktop, mobile: clampBannerHeight(v) })}
      />
      <p className="text-xs text-zinc-500">
        The image always fills the full width and is cropped to fit. Mobile applies below 768px.
      </p>
      <Button
        type="button"
        variant="secondary"
        onClick={() => onChange({ desktop: undefined, mobile: undefined })}
      >
        Reset to default
      </Button>
    </div>
  );
}
