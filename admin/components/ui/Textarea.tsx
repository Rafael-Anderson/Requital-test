"use client";

import { forwardRef, useId, type TextareaHTMLAttributes } from "react";

// Adapted from Origin UI's Textarea-with-error on 21st.dev
// (https://21st.dev/@originui/components/textarea/textarea-with-error) —
// same palette translation as Input.tsx.
interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, className = "", id, rows = 3, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div>
      <label
        htmlFor={inputId}
        className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5"
      >
        {label}
      </label>
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        aria-invalid={!!error}
        className={`flex w-full rounded-lg border bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 transition-shadow outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-50 resize-y ${
          error
            ? "border-red-400 dark:border-red-700 text-red-700 dark:text-red-400 focus:border-red-400 focus:ring-[3px] focus:ring-red-500/20"
            : "border-black/15 dark:border-white/15 focus:border-black/40 dark:focus:border-white/40 focus:ring-[3px] focus:ring-black/10 dark:focus:ring-white/15"
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
