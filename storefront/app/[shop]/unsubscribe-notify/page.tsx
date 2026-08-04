"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { unsubscribeNotifyMe } from "@/lib/api";
import StorefrontPageShell from "@/components/StorefrontPageShell";

// One-click unsubscribe target for the back-in-stock notify email's link —
// fires the DELETE on mount, no confirmation step (the email itself was the
// deliberate action).
export default function UnsubscribeNotifyPage() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email");
  const productId = searchParams.get("productId");
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    if (!email || !productId) {
      setStatus("error");
      return;
    }
    unsubscribeNotifyMe(email, Number(productId))
      .then(() => setStatus("done"))
      .catch(() => setStatus("error"));
  }, [email, productId]);

  return (
    <StorefrontPageShell variant="narrow">
      <div className="text-center">
        {status === "loading" && <p className="text-zinc-500">Unsubscribing…</p>}
        {status === "done" && <p>You've been unsubscribed from restock notifications for this item.</p>}
        {status === "error" && <p className="text-red-600">Couldn't process this unsubscribe link.</p>}
      </div>
    </StorefrontPageShell>
  );
}
