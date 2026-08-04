import type { ButtonHTMLAttributes } from "react";
import Spinner from "./Spinner";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANT_STYLES: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover",
  secondary:
    "border border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10",
  danger:
    "border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950",
  ghost: "hover:bg-black/5 dark:hover:bg-white/10 text-zinc-600 dark:text-zinc-400",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md";
  // Shows an inline spinner and disables the button — the standard
  // "form is submitting" treatment, so callers don't hand-roll their own
  // disabled-and-swap-the-label logic per button.
  loading?: boolean;
}

export default function Button({
  variant = "secondary",
  size = "md",
  className = "",
  disabled,
  loading,
  children,
  ...props
}: ButtonProps) {
  const sizeClass = size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-1.5 rounded font-medium transition-[background-color,border-color,color,transform] duration-100 ease-out cursor-pointer active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 ${sizeClass} ${VARIANT_STYLES[variant]} ${className}`}
      {...props}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  );
}
