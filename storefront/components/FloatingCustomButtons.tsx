"use client";

import { useShop } from "@/lib/shop-context";
import { resolveImageUrl } from "@/lib/api";
import type { FloatingCustomButton } from "@/lib/theme-config-types";

// Persistent floating link buttons (theme-builder-expansion Phase 6, TBE7) —
// a loyalty/rewards launcher, a "book a consultation" link, a chat page.
// LINK-OUT ONLY: no embedded third-party scripts. Stacked above the
// WhatsApp button on whichever side each one chose. Renders nothing when the
// theme has no floatingElements config (older themes) or an empty list.
function isValid(b: unknown): b is FloatingCustomButton {
  return (
    !!b &&
    typeof b === "object" &&
    typeof (b as FloatingCustomButton).id === "string" &&
    typeof (b as FloatingCustomButton).label === "string" &&
    !!(b as FloatingCustomButton).label &&
    typeof (b as FloatingCustomButton).url === "string" &&
    !!(b as FloatingCustomButton).url
  );
}

export default function FloatingCustomButtons() {
  const { themeConfig } = useShop();
  const raw = themeConfig?.globalSettings.floatingElements?.customButtons;
  const buttons = Array.isArray(raw) ? raw.filter(isValid) : [];
  if (buttons.length === 0) return null;

  const right = buttons.filter((b) => b.position !== "bottom_left");
  const left = buttons.filter((b) => b.position === "bottom_left");

  return (
    <>
      {right.length > 0 && <Stack buttons={right} side="right" />}
      {left.length > 0 && <Stack buttons={left} side="left" />}
    </>
  );
}

// Sits above the WhatsApp button (which is at bottom-5, size-14 ≈ 3.5rem) —
// start this stack higher so they don't overlap when both are on the same
// side.
function Stack({ buttons, side }: { buttons: FloatingCustomButton[]; side: "left" | "right" }) {
  return (
    <div className={`fixed bottom-24 z-40 flex flex-col gap-2 ${side === "left" ? "left-5 items-start" : "right-5 items-end"}`}>
      {buttons.map((b) => {
        const icon = resolveImageUrl(b.iconUrl ?? null);
        return (
          <a
            key={b.id}
            href={b.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-full bg-accent text-accent-foreground px-4 h-11 text-sm font-medium shadow-lg shadow-black/20 theme-hover-zoom"
          >
            {icon && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={icon} alt="" className="size-5 rounded-full object-cover shrink-0" />
            )}
            {b.label}
          </a>
        );
      })}
    </div>
  );
}
