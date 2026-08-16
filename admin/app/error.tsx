"use client";

import { useEffect } from "react";

// Route-segment error boundary (see node_modules/next/dist/docs/.../error.md
// — Next 16.3's stable API). Specifically targets the "stale JS chunk after
// a deploy" failure mode: this app's build hashes every chunk filename, so
// a tab left open across a deploy (which replaces .next/ entirely) can
// request a chunk that no longer exists and throw ChunkLoadError the moment
// the user navigates to a route they hadn't already loaded — previously an
// unrecoverable blank/broken page. A hard reload always fetches the fresh
// HTML shell with correct chunk references, which recovers it automatically
// instead of leaving the merchant stuck.
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
