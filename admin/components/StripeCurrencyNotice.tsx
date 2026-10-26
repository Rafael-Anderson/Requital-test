import { STRIPE_CURRENCY_WARNING } from "@/lib/blocked-gateway-currencies";

export default function StripeCurrencyNotice({ className = "" }: { className?: string }) {
  return (
    <p
      role="alert"
      className={`rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200 ${className}`}
    >
      {STRIPE_CURRENCY_WARNING}
    </p>
  );
}
