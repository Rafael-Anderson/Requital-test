"use client";

import { useState, type FormEvent } from "react";
import { createBranchRole, updateBranchRole } from "@/lib/api";
import { ALL_PERMISSIONS, PERMISSION_LABELS, type BranchRole, type Permission } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Checkbox from "@/components/ui/Checkbox";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

// A branch role is just a name + a subset of the fixed permission
// vocabulary — restrict-only enforcement (a staff member can never end up
// with more access than their shop-wide role already grants) happens
// server-side via intersection, not here; this only decides what's
// nominally bundled together for reuse across outlets.
export default function BranchRoleFormModal({
  role,
  onClose,
  onSaved,
}: {
  role: BranchRole | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(role?.name ?? "");
  const [permissions, setPermissions] = useState<Set<Permission>>(new Set(role?.permissions ?? []));
  const [saving, setSaving] = useState(false);

  function togglePermission(permission: Permission, checked: boolean) {
    setPermissions((prev) => {
      const next = new Set(prev);
      if (checked) next.add(permission);
      else next.delete(permission);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const data = { name: name.trim(), permissions: Array.from(permissions) };
      if (role) {
        await updateBranchRole(role.id, data);
        toast(`"${name.trim()}" updated`);
      } else {
        await createBranchRole(data);
        toast(`"${name.trim()}" created`);
      }
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save branch role", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} size="sm" title={role ? "Edit branch role" : "New branch role"}>
      {(requestClose) => (
      <form onSubmit={handleSubmit}>
        <p className="text-sm text-zinc-500 -mt-2 mb-4">
          A reusable permission bundle you can assign to a staff member at a specific outlet.
        </p>

        <div className="space-y-3.5">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />

          <div>
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">
              Permissions
            </label>
            <div className="space-y-2">
              {ALL_PERMISSIONS.map((permission) => (
                <Checkbox
                  key={permission}
                  label={PERMISSION_LABELS[permission]}
                  checked={permissions.has(permission)}
                  onChange={(e) => togglePermission(permission, e.target.checked)}
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              A staff member assigned this bundle at an outlet can never end up with more access than
              their existing shop-wide role already allows. An outlet assignment can only restrict, never
              upgrade.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5 pb-6 sticky bottom-0 bg-white dark:bg-zinc-900">
          <Button type="button" variant="secondary" onClick={requestClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving} loading={saving}>
            {saving ? "Saving…" : role ? "Save changes" : "Create branch role"}
          </Button>
        </div>
      </form>
      )}
    </Modal>
  );
}
