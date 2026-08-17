"use client";

import { forwardRef, useId, type TextareaHTMLAttributes } from "react";
import { Info } from "lucide-react";
import Tooltip from "./Tooltip";

// Adapted from Origin UI's Textarea-with-error on 21st.dev
// (https://21st.dev/@originui/components/textarea/textarea-with-error) —
// same palette translation as Input.tsx.
interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  // Only for fields where the label alone doesn't convey what the setting
  // does — not every field needs one, see Tooltip.tsx's own call sites.
  tooltip?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, tooltip, className = "", id, rows = 3, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1">
        <label htmlFor={inputId} className="text-[13px] font-medium text-text-secondary dark:text-zinc-400">
          {label}
        </label>
        {tooltip && (
          <Tooltip label={tooltip}>
            <Info className="size-3.5 text-zinc-400" />
          </Tooltip>
        )}
      </div>
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        aria-invalid={!!error}
        className={`flex w-full rounded-[10px] border bg-surface dark:bg-zinc-900 px-3 py-2 text-sm transition-shadow outline-none placeholder:text-text-faint disabled:cursor-not-allowed disabled:opacity-50 resize-y ${
          error
            ? "border-red-400 dark:border-red-700 text-red-700 dark:text-red-400 focus:border-red-400 focus:ring-[3px] focus:ring-red-500/20"
            : "border-border dark:border-white/15 focus:border-accent focus:ring-[3px] focus:ring-accent/20"
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

export default Textarea;
