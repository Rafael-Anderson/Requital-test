"use client";

import { useState, type FormEvent } from "react";
import { updateStaffUser } from "@/lib/api";
import { STAFF_ROLE_LABELS, type AuthUser, type Outlet, type UserRole } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import Combobox from "@/components/ui/Combobox";
import { useToast } from "@/components/ui/Toast";

const ROLE_OPTIONS: UserRole[] = ["branch", "order_manager", "viewer", "admin"];

// The first place an existing staff member's shop-wide role/outlet pin
// becomes editable at all (create-only before this) — email is
// deliberately not editable here, same minimal scope as the rest of this
// pass; changing someone else's email would need its own re-verification
// flow this doesn't build.
export default function EditStaffUserFormModal({
  user,
  outlets,
  onClose,
  onSaved,
}: {
  user: AuthUser;
  outlets: Outlet[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<UserRole>(user.role);
  const [outletId, setOutletId] = useState(user.outletId ? String(user.outletId) : outlets[0] ? String(outlets[0].id) : "");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const needsOutlet = role === "branch";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || (needsOutlet && !outletId)) return;
    setSaving(true);
    try {
      await updateStaffUser(user.id, {
        name,
        role,
        ...(needsOutlet ? { outletId: Number(outletId) } : {}),
      });
      toast(`${name} updated`);
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update account", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} size="sm" title="Edit staff account">
      {(requestClose) => (
      <form onSubmit={handleSubmit}>
        <div className="space-y-3.5">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <p className="text-xs text-zinc-400 -mt-2">{user.email}</p>

          <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {STAFF_ROLE_LABELS[r]}
              </option>
            ))}
          </Select>

          {needsOutlet && (
            <Combobox
              label="Outlet"
              value={outletId}
              onChange={setOutletId}
              options={outlets.map((o) => ({ value: String(o.id), label: o.name }))}
            />
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5 pb-6 sticky bottom-0 bg-white dark:bg-zinc-900">
          <Button type="button" variant="secondary" onClick={requestClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving || (needsOutlet && outlets.length === 0)} loading={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
      )}
    </Modal>
  );
}
