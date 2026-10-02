"use client";

import { useState, type FormEvent } from "react";
import { addSupplierContact, updateSupplierContact } from "@/lib/api";
import type { SupplierContact } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Toggle from "@/components/ui/Toggle";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

export default function SupplierContactFormModal({
  supplierId,
  contact,
  onClose,
  onSaved,
}: {
  supplierId: number;
  contact: SupplierContact | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(contact?.name ?? "");
  const [role, setRole] = useState(contact?.role ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [isPrimary, setIsPrimary] = useState(contact?.isPrimary ?? false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const data = {
      name: name.trim(),
      role: role.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      isPrimary,
    };
    setSaving(true);
    try {
      if (contact) await updateSupplierContact(supplierId, contact.id, data);
      else await addSupplierContact(supplierId, data);
      toast(`"${data.name}" saved`);
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save contact", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} size="sm" title={contact ? "Edit contact" : "New contact"}>
      {(requestClose) => (
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 gap-4">
            <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            <Input label="Role" value={role} onChange={(e) => setRole(e.target.value)} />
            <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <div className="flex items-center gap-3">
              <Toggle checked={isPrimary} onChange={setIsPrimary} />
              <span className="text-sm text-text-secondary dark:text-zinc-300">Primary contact</span>
            </div>
          </div>
          <div className="sticky bottom-0 mt-5 flex justify-end gap-2 bg-surface pb-6 dark:bg-zinc-900">
            <Button type="button" variant="secondary" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving} loading={saving}>
              {saving ? "Saving…" : "Save contact"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
