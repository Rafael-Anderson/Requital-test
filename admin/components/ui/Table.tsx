// Structure and striped/hover row treatment adapted from "Table" (striped
// variant) by Origin UI on 21st.dev
// (https://21st.dev/@originui/components/table/striped-table). shadcn's
// CSS-variable classes (border-border, bg-muted, text-muted-foreground) were
// translated to this project's plain black/white-opacity Tailwind palette
// rather than adding shadcn's theme tokens.
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

export function Table({ className = "", ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className={`overflow-x-auto rounded-lg border border-black/10 dark:border-white/10 ${className}`}>
      <table className="w-full text-sm" {...props} />
    </div>
  );
}

export function THead({ className = "", ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={`bg-black/[0.03] dark:bg-white/5 text-left ${className}`} {...props} />;
}

export function TBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TH({ className = "", ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`p-3 font-medium text-zinc-500 dark:text-zinc-400 ${className}`}
      {...props}
    />
  );
}

export function TR({ className = "", ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={`border-t border-black/5 dark:border-white/10 odd:bg-black/[0.015] dark:odd:bg-white/[0.02] transition-colors hover:bg-black/[0.035] dark:hover:bg-white/[0.05] ${className}`}
      {...props}
    />
  );
}

export function TD({ className = "", ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`p-3 align-middle ${className}`} {...props} />;
}
