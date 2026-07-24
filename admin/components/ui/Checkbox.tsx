import { useId, type InputHTMLAttributes } from "react";
import { Check } from "lucide-react";

// Visual style inspired by Origin UI's Checkbox on 21st.dev
// (https://21st.dev/@originui/components/checkbox) — the native input is
// visually hidden (not display:none — it stays in the box model so it's
// still directly clickable and keyboard/AT accessible) and a peer-styled box
// + icon render its checked/hover/focus/disabled states, rather than relying
// on `accent-color`, which only tints the browser's own flat native
// checkbox shape instead of giving it a real design.
interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export default function Checkbox({ label, id, className = "", ...props }: CheckboxProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const input = (
    <span className={`relative inline-flex size-4 shrink-0 ${className}`}>
      <input
        type="checkbox"
        id={inputId}
        className="peer absolute inset-0 size-4 cursor-pointer appearance-none disabled:cursor-not-allowed"
        {...props}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[5px] border-[1.5px] border-black/25 dark:border-white/30 bg-white dark:bg-zinc-900 transition-colors duration-150 peer-hover:border-black/45 dark:peer-hover:border-white/45 peer-checked:border-black peer-checked:bg-black dark:peer-checked:border-white dark:peer-checked:bg-white peer-focus-visible:ring-2 peer-focus-visible:ring-black/30 dark:peer-focus-visible:ring-white/40 peer-focus-visible:ring-offset-1 peer-disabled:opacity-40"
      />
      <Check
        aria-hidden="true"
        strokeWidth={3}
        className="pointer-events-none absolute inset-0 m-auto size-3 scale-75 text-white opacity-0 transition-all duration-150 dark:text-black peer-checked:scale-100 peer-checked:opacity-100"
      />
    </span>
  );
  if (!label) return input;
  return (
    <label htmlFor={inputId} className="flex items-center gap-2 text-sm cursor-pointer select-none">
      {input}
      {label}
    </label>
  );
}
