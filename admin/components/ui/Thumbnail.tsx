"use client";

import { useState } from "react";
import { Package } from "lucide-react";
import { resolveImageUrl } from "@/lib/api";

export default function Thumbnail({
  src,
  size = "size-12",
}: {
  src?: string | null;
  size?: string;
}) {
  const [broken, setBroken] = useState(false);
  const resolved = resolveImageUrl(src);
  if (!resolved || broken) {
    return (
      <div
        className={`${size} rounded-md bg-black/5 dark:bg-white/10 flex items-center justify-center text-zinc-400 shrink-0`}
      >
        <Package className="size-5" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={resolved}
      alt=""
      onError={() => setBroken(true)}
      className={`${size} rounded-md object-cover shrink-0`}
    />
  );
}
