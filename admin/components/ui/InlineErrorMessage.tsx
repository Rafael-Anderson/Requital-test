import type { ReactNode } from "react";

// The boxed (bordered + tinted background) form-level error, extracted from
// app/login/page.tsx's original inline div — for a whole-form/panel error,
// not a per-field one (Input.tsx/Select.tsx/Textarea.tsx's own built-in
// `error` prop, or FieldErrorMessage.tsx, already own that narrower case).
export default function InlineErrorMessage({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={`rounded-md border border-red-400 bg-red-100 px-3 py-2 text-[13px] text-red-700 dark:border-red-500 dark:bg-red-950 dark:text-red-400 ${className}`}
    >
      {children}
    </div>
  );
}
