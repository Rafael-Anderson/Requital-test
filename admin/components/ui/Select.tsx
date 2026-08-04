"use client";

// Native <select> wrapper — same relationship to <select> that Input.tsx has
// to <input>: one place owning the shared trigger classes (height, radius,
// border, focus ring) instead of the `SELECT_CLASS`/`FIELD_CLASS` constant
// duplicated across two dozen modal/form files. Deliberately still a native
// element rather than a hand-rolled listbox — keyboard nav, mobile picker
// UI, and screen-reader semantics all come free from the platform, matching
// shadcn's own SelectTrigger/SelectContent visual contract (trigger height,
// chevron, focus ring) without reimplementing what <select> already does.
// For a searchable picker (long product/category/outlet lists), use
// Combobox.tsx instead — <select> has no search.
import { forwardRef, useId, type ReactNode, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  children: ReactNode;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, className = "", id, multiple, children, ...props },
  ref,
) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div>
      {label && (
        <label
          htmlFor={selectId}
          className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5"
        >
          {label}
        </label>
      )}
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          multiple={multiple}
          aria-invalid={!!error}
          className={`flex h-9 w-full rounded-lg border bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow appearance-none disabled:cursor-not-allowed disabled:opacity-50 ${
            multiple ? "" : "pr-8"
          } ${
            error
              ? "border-red-400 dark:border-red-700 text-red-700 dark:text-red-400 focus:border-red-400 focus:ring-[3px] focus:ring-red-500/20"
              : "border-black/15 dark:border-white/15 focus:border-accent focus:ring-[3px] focus:ring-accent/20"
          } ${className}`}
          {...props}
        >
          {children}
        </select>
        {!multiple && (
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
        )}
      </div>
      {error && (
        <p className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
});

export default Select;
