"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// Always navigates to the given logical parent route — not browser history
// (that was the old behavior; reverted deliberately). router.back()/history
// meant switching tabs within a section, or any other in-app navigation,
// polluted the back target: clicking "Back" from Movement History could
// land on whichever tab was last visited instead of the Inventory list.
// Every call site passes its own actual parent route explicitly.
export default function BackButton({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-text-muted transition-colors hover:text-accent-text dark:hover:text-zinc-200"
    >
      <ArrowLeft className="size-4" />
      Back
    </Link>
  );
}
