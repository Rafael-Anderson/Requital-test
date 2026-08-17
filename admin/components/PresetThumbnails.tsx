import { ShoppingCart, Menu } from "lucide-react";
import type { HomepageLayout, TopBarLayout, PdpLayout, CartLayout, CheckoutLayout, IconStyle, ButtonRadius, ButtonFill, FooterLayout, Density } from "@/lib/types";

// Small static illustrations (not live-rendered previews, per the task
// brief — same rule as the original homepage-layout thumbnails) sketching
// what each preset includes, so a merchant can tell options apart without
// saving and checking the live storefront first.
const BOX = "rounded bg-accent/20";
const BAR = "rounded bg-black/10 dark:bg-white/10";
const FRAME = "w-full h-24 rounded-md bg-zinc-100 dark:bg-zinc-800 p-2 flex flex-col gap-1.5";

export function HomepageLayoutThumbnail({ layout }: { layout: HomepageLayout }) {
  if (layout === "slideshow") {
    return (
      <div className={FRAME}>
        <div className={`flex-1 ${BOX} relative`}>
          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-1">
            <span className="size-1.5 rounded-full bg-accent" />
            <span className={`size-1.5 rounded-full ${BAR}`} />
            <span className={`size-1.5 rounded-full ${BAR}`} />
          </div>
        </div>
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`flex-1 h-4 ${BAR}`} />
          ))}
        </div>
      </div>
    );
  }
  if (layout === "featured_grid") {
    return (
      <div className={FRAME}>
        <div className={`h-6 ${BOX}`} />
        <div className="flex gap-1">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex-1 aspect-square rounded bg-accent/30" />
          ))}
        </div>
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`flex-1 h-4 ${BAR}`} />
          ))}
        </div>
      </div>
    );
  }
  if (layout === "grid_first") {
    return (
      <div className={FRAME}>
        <div className="h-3 w-1/2 rounded bg-black/15 dark:bg-white/15" />
        <div className="grid grid-cols-3 gap-1 flex-1">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="rounded bg-accent/25" />
          ))}
        </div>
      </div>
    );
  }
  // classic
  return (
    <div className={FRAME}>
      <div className={`h-10 ${BOX}`} />
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`flex-1 h-8 ${BAR}`} />
        ))}
      </div>
    </div>
  );
}

export function TopBarLayoutThumbnail({ layout }: { layout: TopBarLayout }) {
  if (layout === "logo_center") {
    return (
      <div className={FRAME}>
        <div className="flex items-center justify-between h-6">
          <span className="size-3 rounded-full bg-black/10 dark:bg-white/10" />
          <div className="h-3 w-10 rounded bg-accent/30" />
          <div className="flex gap-1">
            <span className="size-3 rounded-full bg-black/10 dark:bg-white/10" />
            <span className="size-3 rounded-full bg-black/10 dark:bg-white/10" />
          </div>
        </div>
        <div className="flex-1" />
      </div>
    );
  }
  if (layout === "minimal") {
    return (
      <div className={FRAME}>
        <div className="flex items-center justify-between h-6">
          <Menu className="size-4 text-text-faint" />
          <div className="h-3 w-10 rounded bg-accent/30" />
          <ShoppingCart className="size-4 text-text-faint" />
        </div>
        <div className="flex-1" />
      </div>
    );
  }
  // logo_left
  return (
    <div className={FRAME}>
      <div className="flex items-center justify-between h-6">
        <div className="h-3 w-10 rounded bg-accent/30" />
        <div className="flex gap-1">
          <span className="size-3 rounded-full bg-black/10 dark:bg-white/10" />
          <span className="size-3 rounded-full bg-black/10 dark:bg-white/10" />
          <span className="size-3 rounded-full bg-black/10 dark:bg-white/10" />
        </div>
      </div>
      <div className="flex-1" />
    </div>
  );
}

export function PdpLayoutThumbnail({ layout }: { layout: PdpLayout }) {
  if (layout === "gallery_top") {
    return (
      <div className={FRAME}>
        <div className={`h-10 ${BOX}`} />
        <div className="flex flex-col gap-1">
          {[0, 1].map((i) => (
            <div key={i} className={`h-2.5 ${BAR}`} />
          ))}
        </div>
      </div>
    );
  }
  // gallery_left
  return (
    <div className={FRAME}>
      <div className="flex gap-1.5 flex-1">
        <div className={`flex-1 ${BOX}`} />
        <div className="flex-1 flex flex-col gap-1 justify-center">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`h-2.5 ${BAR}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function CartLayoutThumbnail({ layout }: { layout: CartLayout }) {
  if (layout === "drawer") {
    return (
      <div className={`${FRAME} !flex-row !p-0 overflow-hidden`}>
        <div className="flex-1 bg-zinc-100 dark:bg-zinc-800" />
        <div className="w-8 bg-surface dark:bg-zinc-900 border-l border-border dark:border-white/10 flex flex-col gap-1 p-1">
          {[0, 1].map((i) => (
            <div key={i} className="h-2.5 rounded bg-accent/25" />
          ))}
        </div>
      </div>
    );
  }
  // full_page
  return (
    <div className={FRAME}>
      {[0, 1, 2].map((i) => (
        <div key={i} className={`h-4 ${BAR}`} />
      ))}
    </div>
  );
}

export function CheckoutLayoutThumbnail({ layout }: { layout: CheckoutLayout }) {
  if (layout === "step_by_step") {
    return (
      <div className={FRAME}>
        <div className="flex items-center gap-1.5 mb-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`size-3.5 rounded-full flex items-center justify-center ${i === 0 ? "bg-accent" : "bg-black/10 dark:bg-white/10"}`} />
          ))}
        </div>
        {[0, 1].map((i) => (
          <div key={i} className={`h-4 ${BAR}`} />
        ))}
      </div>
    );
  }
  // single_page
  return (
    <div className={FRAME}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={`h-3 ${BAR}`} />
      ))}
    </div>
  );
}

export function IconStyleThumbnail({ style }: { style: IconStyle }) {
  return (
    <div className={`${FRAME} items-center justify-center flex-row gap-3`}>
      <ShoppingCart className="size-6 text-accent" fill={style === "solid" ? "currentColor" : "none"} strokeWidth={style === "solid" ? 0.5 : 1.75} />
    </div>
  );
}

export function FooterLayoutThumbnail({ layout }: { layout: FooterLayout }) {
  if (layout === "centered") {
    return (
      <div className={`${FRAME} items-center`}>
        <div className="h-3 w-10 rounded bg-accent/30" />
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`h-2 w-6 ${BAR}`} />
          ))}
        </div>
        <div className={`h-2 w-16 ${BAR}`} />
      </div>
    );
  }
  // columns
  return (
    <div className={FRAME}>
      <div className="flex gap-2 flex-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex-1 flex flex-col gap-1">
            <div className={`h-2 w-2/3 ${i === 0 ? "bg-accent/30" : "bg-black/10 dark:bg-white/10"} rounded`} />
            <div className={`h-1.5 ${BAR}`} />
            <div className={`h-1.5 ${BAR}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

// Shared by header and footer density pickers — three bar heights sketching
// "less padding" -> "more padding" rather than a literal chrome mockup,
// since the actual visual difference IS the padding, not a structural change.
export function DensityThumbnail({ density }: { density: Density }) {
  const barHeight = density === "compact" ? "h-3" : density === "spacious" ? "h-8" : "h-5";
  return (
    <div className={`${FRAME} items-center justify-center`}>
      <div className={`w-full ${barHeight} ${BOX} flex items-center justify-center`}>
        <div className="h-1.5 w-8 rounded bg-accent/50" />
      </div>
    </div>
  );
}

export function ButtonStyleThumbnail({ radius, fill }: { radius: ButtonRadius; fill: ButtonFill }) {
  const radiusClass = radius === "sharp" ? "rounded-none" : radius === "pill" ? "rounded-full" : "rounded-lg";
  return (
    <div className={`${FRAME} items-center justify-center`}>
      <div
        className={`h-8 w-20 flex items-center justify-center text-[11px] font-medium ${radiusClass} ${
          fill === "outline" ? "border-2 border-accent text-accent bg-transparent" : "bg-accent text-white"
        }`}
      >
        Button
      </div>
    </div>
  );
}
