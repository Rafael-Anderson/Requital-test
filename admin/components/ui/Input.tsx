"use client";

import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { Info } from "lucide-react";
import Tooltip from "./Tooltip";

// Adapted from Origin UI's Input / Input-with-error on 21st.dev
// (https://21st.dev/@originui/components/input,
// https://21st.dev/@originui/components/input/input-with-error) — shadcn's
// CSS-variable classes (bg-background, border-input, ring-ring, text-destructive)
// translated to this project's plain black/white/zinc Tailwind palette, same
// as the rest of components/ui.
interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  // Only for fields where the label alone doesn't convey what the setting
  // does — not every field needs one, see Tooltip.tsx's own call sites.
  tooltip?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, tooltip, className = "", id, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1">
        <label htmlFor={inputId} className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          {label}
        </label>
        {tooltip && (
          <Tooltip label={tooltip}>
            <Info className="size-3.5 text-zinc-400" />
          </Tooltip>
        )}
      </div>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={!!error}
        className={`flex h-9 w-full rounded-lg border bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 transition-shadow outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-50 ${
          error
            ? "border-red-400 dark:border-red-700 text-red-700 dark:text-red-400 focus:border-red-400 focus:ring-[3px] focus:ring-red-500/20"
            : "border-black/15 dark:border-white/15 focus:border-accent focus:ring-[3px] focus:ring-accent/20"
        } ${className}`}
        {...props}
      />
      {error && (
        <p className="mt-1.5 text-xs text-red-600 dark:text-red-400" role="alert" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
});

export default Input;
