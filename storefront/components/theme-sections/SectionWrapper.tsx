import type { CSSProperties, ReactNode } from "react";
import type { SectionSettings } from "@/lib/theme-config-types";

function backgroundStyle(bg: SectionSettings["background"]): CSSProperties {
  if (!bg || typeof bg !== "object") return {};
  const type = bg.type as string | undefined;
  if (type === "solid" && typeof bg.color === "string") {
    return { background: bg.color };
  }
  if (type === "gradient" && typeof bg.gradientFrom === "string" && typeof bg.gradientTo === "string") {
    return { background: `linear-gradient(135deg, ${bg.gradientFrom}, ${bg.gradientTo})` };
  }
  if (type === "image" && typeof bg.imageUrl === "string") {
    return { backgroundImage: `url(${bg.imageUrl})`, backgroundSize: "cover", backgroundPosition: "center" };
  }
  return {};
}

// Applies every section's shared settings (padding, background, visibility)
// — the one place SectionRenderer routes every section type through, so a
// new section type gets these for free rather than reimplementing them.
// Scroll animation is applied by ScrollAnimatedWrapper (Phase 5), which
// wraps this component rather than being folded into it.
export default function SectionWrapper({
  settings,
  children,
}: {
  settings: SectionSettings;
  children: ReactNode;
}) {
  const spacing = settings.spacing ?? {};
  const visibility = settings.visibility ?? "both";
  const visibilityClass =
    visibility === "desktop" ? "hidden md:block" : visibility === "mobile" ? "block md:hidden" : "";

  return (
    <section
      className={visibilityClass}
      style={{
        paddingTop: spacing.top !== undefined ? `${spacing.top}px` : undefined,
        paddingBottom: spacing.bottom !== undefined ? `${spacing.bottom}px` : undefined,
        paddingLeft: spacing.left !== undefined ? `${spacing.left}px` : undefined,
        paddingRight: spacing.right !== undefined ? `${spacing.right}px` : undefined,
        ...backgroundStyle(settings.background),
      }}
    >
      {children}
    </section>
  );
}
