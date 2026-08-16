"use client";

import { useEffect } from "react";

// Same rationale as admin/app/error.tsx — see that file's comment. No shop
// theming (CSS vars from ShopProvider) is relied on here deliberately: a
// ChunkLoadError can fire before ShopProvider ever finishes loading, so this
// fallback only uses plain, always-available Tailwind classes.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (error.name === "ChunkLoadError" || error.message.includes("Loading chunk")) {
      window.location.reload();
    }
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white dark:bg-zinc-950">
      <div className="text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">Something went wrong. Refreshing…</p>
        <button type="button" onClick={reset} className="mt-4 text-sm text-teal-600 dark:text-teal-400 underline">
          Try again
        </button>
      </div>
    </div>
  );
}
