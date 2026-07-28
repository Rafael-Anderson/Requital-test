import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

// The one place page-level width/columns are decided — every admin
// app/**/page.tsx (and DraftOrderBuilder, which needs "split" from inside a
// <form>) renders through this instead of hand-rolling its own wrapper div,
// which is how pages ended up with inconsistent/missing max-widths and
// lopsided sidebars (see the Product Form and Draft Order layout fixes).
//
// - "wide": tables, dashboards, and pages whose content already manages its
//   own internal grid (e.g. ProductForm's own main+sidebar split) — full
//   available width.
// - "form": a single narrow column for data-entry/detail content that
//   doesn't need the extra width — capped at max-w-4xl. (Was max-w-3xl;
//   widened after SEO/Payment Gateways — both genuinely single-column, no
//   internal grid — still read as an arbitrarily narrow box with ~400px of
//   dead space on a normal desktop viewport. A page having no multi-column
//   grid doesn't mean 768px is the right cap; measure the rendered result
//   against real available width, don't assume single-column implies
//   "as narrow as possible" is correct.)
// - "split": a form column plus a persistent right-hand `aside` (e.g. a live
//   summary card) — for pages where the sidebar would otherwise stay much
//   shorter than the main column if left to its own natural content height.
type PageShellVariant = "wide" | "form" | "split";

type PageShellProps<T extends ElementType> = {
  variant?: PageShellVariant;
  aside?: ReactNode;
  as?: T;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "children" | "className">;

export default function PageShell<T extends ElementType = "div">({
  variant = "wide",
  aside,
  as,
  children,
  ...rest
}: PageShellProps<T>) {
  const Tag = (as ?? "div") as ElementType;

  if (variant === "split") {
    return (
      <Tag className="page-transition grid grid-cols-1 lg:grid-cols-3 gap-4 items-start" {...rest}>
        <div className="lg:col-span-2 space-y-4">{children}</div>
        <div className="space-y-4 lg:sticky lg:top-6">{aside}</div>
      </Tag>
    );
  }

  return (
    <Tag className={variant === "form" ? "page-transition max-w-4xl" : "page-transition"} {...rest}>
      {children}
    </Tag>
  );
}
