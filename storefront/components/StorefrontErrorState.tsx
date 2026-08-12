"use client";

import { Unplug } from "lucide-react";

interface StorefrontErrorStateProps {
  // "error": the shop is real but couldn't be reached right now (a fetch
  // failure) — offers a retry, since reloading might just work.
  // "not-found": the subdomain/custom domain doesn't resolve to any shop at
  // all (see app/store-not-found/page.tsx) — reloading can't fix that, so no
  // retry button.
  variant: "error" | "not-found";
}

// Full-viewport placeholder for "the shop itself couldn't be resolved" —
// not a per-widget error message for a page's own secondary fetch (e.g. a
// collection lookup failing keeps its own inline text).
export default function StorefrontErrorState({ variant }: StorefrontErrorStateProps) {
  const notFound = variant === "not-found";

  return (
    <div className="min-h-screen w-full bg-white flex flex-col items-center justify-center gap-3 p-6 text-center">
      <Unplug className="size-12 text-gray-400" strokeWidth={1.5} />
      <h1 className="text-2xl font-semibold text-gray-900">
        {notFound ? "Store not found" : "This store is unavailable"}
      </h1>
      <p className="text-sm text-gray-500 max-w-sm">
        {notFound
          ? "This store doesn't exist or may have moved."
          : "We couldn't connect to this store. Please try again later."}
      </p>
      {!notFound && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-2 h-10 px-5 rounded-md bg-[#0d9488] text-white text-sm font-medium hover:opacity-90 cursor-pointer"
        >
          Try again
        </button>
      )}
    </div>
  );
}
