"use client";

import { useState } from "react";
import { confirmMyAccountDeletion, requestMyAccountDeletion } from "@/lib/api";
import { BUTTON_OUTLINE_CLASS } from "@/lib/form-styles";

// UAE PDPL self-serve deletion — a single confirmation click drives both
// backend steps (request -> confirm) back-to-back; the confirmationToken
// only ever lives in this component's own memory for that instant, never
// shown to the user or persisted. Same overlay+card modal shape as
// checkout/AddonPrompt.tsx (this app has no shared Modal primitive), except
// the backdrop only closes on click while not mid-delete — an in-flight
// deletion shouldn't be dismissable out from under itself.
export default function DeleteAccountModal({
  shopSlug,
  onClose,
  onDeleted,
}: {
  shopSlug: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setDeleting(true);
    setError(null);
    try {
      const requested = await requestMyAccountDeletion(shopSlug);
      if (!requested.alreadyDeleted) {
        await confirmMyAccountDeletion(shopSlug, requested.confirmationToken!);
      }
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete your account");
      setDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={deleting ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg bg-header text-header-fg p-6"
      >
        <h2 className="text-lg font-semibold">Delete your account?</h2>
        <p className="mt-2 text-sm text-zinc-500">
          This cannot be undone. Your orders will remain in the merchant&apos;s records but your personal data will
          be removed.
        </p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className={`h-10 px-4 rounded-lg text-sm cursor-pointer disabled:opacity-50 ${BUTTON_OUTLINE_CLASS}`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={deleting}
            className="h-10 px-4 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
          >
            {deleting ? "Deleting…" : "Yes, delete my account"}
          </button>
        </div>
      </div>
    </div>
  );
}
