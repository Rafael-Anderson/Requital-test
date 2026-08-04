"use client";

import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { createAffiliate, updateAffiliate } from "@/lib/api";
import { AFFILIATE_STATUSES, type AffiliateListItem, type AffiliateStatus } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Combobox from "@/components/ui/Combobox";
import { useToast } from "@/components/ui/Toast";

export default function AffiliateFormModal({
  affiliate,
  onClose,
  onSaved,
}: {
  affiliate: AffiliateListItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(affiliate?.name ?? "");
  const [mobile, setMobile] = useState(affiliate?.mobile ?? "");
  const [status, setStatus] = useState<AffiliateStatus>(affiliate?.status ?? "active");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !mobile.trim()) return;
    setSaving(true);
    try {
      if (affiliate) {
        await updateAffiliate(affiliate.id, { name, mobile, status });
        toast(`"${name}" updated`);
      } else {
        await createAffiliate({ name, mobile });
        toast(`"${name}" added`);
      }
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save affiliate", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
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

        <h2 className="text-lg font-semibold mb-4">{affiliate ? `Edit "${affiliate.name}"` : "Add User"}</h2>

        <div className="space-y-3.5">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input label="Mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} required />
          {affiliate && (
            <Combobox
              label="Status"
              value={status}
              onChange={(value) => setStatus(value as AffiliateStatus)}
              options={AFFILIATE_STATUSES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
            />
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {affiliate ? "Save changes" : "Add"}
          </Button>
        </div>
      </form>
    </div>
  );
}
