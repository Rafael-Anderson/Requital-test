"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createOutlet } from "@/lib/api";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
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
    <Modal onClose={onClose} size="sm" title="New outlet">
      {(requestClose) => (
      <form onSubmit={handleSubmit}>
        <p className="text-sm text-zinc-500 -mt-2 mb-4">
          Give it a name — you&apos;ll set hours, address, delivery, and pickup next.
        </p>

        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />

        <div className="flex justify-end gap-2 mt-5 pb-6 sticky bottom-0 bg-white dark:bg-zinc-900">
          <Button type="button" variant="secondary" onClick={requestClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving} loading={saving}>
            Create & continue
          </Button>
        </div>
      </form>
      )}
    </Modal>
  );
}
