// Structure and striped/hover row treatment adapted from "Table" (striped
// variant) by Origin UI on 21st.dev
// (https://21st.dev/@originui/components/table/striped-table). shadcn's
// CSS-variable classes (border-border, bg-muted, text-muted-foreground) were
// translated to this project's plain black/white-opacity Tailwind palette
// rather than adding shadcn's theme tokens.
//
// Row-action convention: per-row Edit/Delete (and similar) actions are
// icon-only buttons, one per action, each its own trailing `<TH className=
// "w-10"></TH>` / `<TD>` pair — a lucide icon (Pencil/Trash2/...), no visible
// text, `aria-label={`Edit ${name}`}`, this exact class pair:
//   edit/neutral: "p-1.5 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
//   delete:       "p-1.5 rounded text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
// (see Products/Ingredients/Collections/Templates for reference). Two other
// treatments — a full `Button` with visible text, and a plain underlined
// text link — existed on different list pages before being converged onto
// this one; don't reintroduce either for a new list page's row actions.
import ScrollFade from "@/components/ui/ScrollFade";
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

// Scrolls sideways inside its own rounded container with an edge fade (see
// ScrollFade) when the columns do not fit; `stickyFirst` pins the first column
// for a wide table whose row identity lives there.
export function Table({
  className = "",
  stickyFirst = false,
  ...props
}: HTMLAttributes<HTMLTableElement> & { stickyFirst?: boolean }) {
  return (
    <ScrollFade
      stickyFirst={stickyFirst}
      className={`rounded-2xl border border-border bg-surface dark:border-white/10 dark:bg-zinc-900 ${className}`}
    >
      <table className="w-full text-sm" {...props} />
    </ScrollFade>
  );
}

export function THead({ className = "", ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={`border-b border-border text-start dark:border-white/10 ${className}`} {...props} />;
}

export function TBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TH({ className = "", ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`p-3 text-[11.5px] font-bold tracking-wide text-text-faint uppercase dark:text-zinc-400 ${className}`}
      {...props}
    />
  );
}

export function TR({ className = "", ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={`border-t border-border-light transition-colors hover:bg-[#FAFBFB] dark:border-white/10 dark:hover:bg-white/[0.05] ${className}`}
      {...props}
    />
  );
}

export function TD({ className = "", ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`p-3 align-middle ${className}`} {...props} />;
}
