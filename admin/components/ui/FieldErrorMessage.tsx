import { CircleX } from "lucide-react";

// Icon+text inline error, distinct from Input.tsx/Select.tsx's own built-in
// error paragraph (plain text, no icon) — those two already cover the
// red-border+red-text half of field-level validation for every text/select
// field in the Account Setup wizard, so this component is only reached for
// once: the Operating Model checkbox group (no wrapping Input/Select to
// carry an `error` prop), and the cross-field error modal's bullet list,
// which wants the exact same icon+text treatment per item.
export default function FieldErrorMessage({ message }: { message: string }) {
  return (
    <p
      role="alert"
      aria-live="polite"
      className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400"
    >
      <CircleX className="size-3.5 shrink-0" />
      {message}
    </p>
  );
}
