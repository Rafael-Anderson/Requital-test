"use client";

import { useState, type FormEvent } from "react";
import { createAffiliate, updateAffiliate } from "@/lib/api";
import { AFFILIATE_STATUSES, type AffiliateListItem, type AffiliateStatus } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
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
    <Modal onClose={onClose} size="sm" title={affiliate ? `Edit "${affiliate.name}"` : "Add User"}>
      {(requestClose) => (
      <form onSubmit={handleSubmit}>
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

        <div className="flex justify-end gap-2 mt-5 pb-6 sticky bottom-0 bg-white dark:bg-zinc-900">
          <Button type="button" variant="secondary" onClick={requestClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving} loading={saving}>
            {affiliate ? "Save changes" : "Add"}
          </Button>
        </div>
      </form>
      )}
    </Modal>
  );
}
