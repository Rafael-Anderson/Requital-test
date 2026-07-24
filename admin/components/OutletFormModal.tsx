"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { createOutlet } from "@/lib/api";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

// Creation only collects a name — everything else (contact info, hours,
// address, delivery, pickup) is set on the dedicated edit page immediately
// after, rather than duplicating all of that in a second form here.
export default function OutletFormModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const outlet = await createOutlet({ name });
      toast(`"${name}" created`);
      onClose();
      router.push(`/settings/outlets/${outlet.id}/edit`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to create outlet", "error");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg bg-white dark:bg-zinc-900 border dark:border-white/10 p-6 relative"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>

        <h2 className="text-lg font-semibold mb-1">New outlet</h2>
        <p className="text-sm text-zinc-500 mb-4">
          Give it a name — you&apos;ll set hours, address, delivery, and pickup next.
        </p>

        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />

        <div className="flex justify-end gap-2 mt-5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            Create & continue
          </Button>
        </div>
      </form>
    </div>
  );
}
