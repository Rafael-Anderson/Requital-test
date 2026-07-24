"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getNavDepth } from "@/lib/nav-depth";

// Goes back exactly one level via the router's real history, so it lands
// wherever the user actually came from — not a hardcoded parent. Falls back
// to fallbackHref only when there's no in-app history to go back to (e.g. a
// bookmarked/shared deep link opened directly).
export default function BackButton({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter();

  function handleClick() {
    if (getNavDepth() > 0) router.back();
    else router.push(fallbackHref);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:underline mb-4 transition-colors cursor-pointer"
    >
      <ArrowLeft className="size-4" />
      Back
    </button>
  );
}
