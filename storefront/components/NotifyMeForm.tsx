"use client";

import { useState } from "react";
import { subscribeNotifyMe } from "@/lib/api";

// Shown on the PDP below the add-to-cart area whenever the selected
// product/variant is out of stock. Pure form state — no cart interaction.
export default function NotifyMeForm({
  productId,
  variantId,
}: {
  productId: number;
  variantId?: number;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "subscribed" | "duplicate" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("loading");
    setError(null);
    try {
      const { alreadySubscribed } = await subscribeNotifyMe(productId, email.trim(), variantId);
      setStatus(alreadySubscribed ? "duplicate" : "subscribed");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  if (status === "subscribed") {
    return <p className="mt-3 text-sm text-green-700">You're on the list. We'll email you when it's back.</p>;
  }
  if (status === "duplicate") {
    return <p className="mt-3 text-sm text-zinc-500">You're already on the list.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3">
      <p className="text-sm font-medium mb-1.5">Notify me when available</p>
      <div className="flex gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="flex-1 h-10 rounded-lg border border-stroke bg-white px-3 text-sm outline-none focus:border-accent transition-colors"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="h-10 px-4 rounded-lg border border-stroke text-sm font-medium hover:border-black/30 disabled:opacity-50 cursor-pointer"
        >
          {status === "loading" ? "Sending…" : "Notify me"}
        </button>
      </div>
      {status === "error" && <p className="mt-1.5 text-sm text-red-600">{error}</p>}
    </form>
  );
}
