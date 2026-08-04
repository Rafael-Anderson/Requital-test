"use client";

import { useState, type FormEvent } from "react";
import { assignBranchRole } from "@/lib/api";
import type { AuthUser, BranchRole, Outlet } from "@/lib/types";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import Combobox from "@/components/ui/Combobox";
import { useToast } from "@/components/ui/Toast";

// Upsert on the backend — picking a (user, outlet) pair that already has an
// assignment just re-points it at the newly selected branch role instead of
// erroring, matching the one-assignment-per-user-per-outlet model.
export default function AssignBranchRoleModal({
  users,
  outlets,
  branchRoles,
  onClose,
  onSaved,
}: {
  users: AuthUser[];
  outlets: Outlet[];
  branchRoles: BranchRole[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [userId, setUserId] = useState(users[0] ? String(users[0].id) : "");
  const [outletId, setOutletId] = useState(outlets[0] ? String(outlets[0].id) : "");
  const [branchRoleId, setBranchRoleId] = useState(branchRoles[0] ? String(branchRoles[0].id) : "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!userId || !outletId || !branchRoleId) return;
    setSaving(true);
    try {
      await assignBranchRole({
        userId: Number(userId),
        outletId: Number(outletId),
        branchRoleId: Number(branchRoleId),
      });
      toast("Branch role assigned");
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to assign branch role", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} size="sm" title="Assign branch role">
      {(requestClose) => (
      <form onSubmit={handleSubmit}>
        <p className="text-sm text-zinc-500 -mt-2 mb-4">
          Overrides this staff member&apos;s access at one specific outlet only — their access at every
          other outlet is unaffected.
        </p>

        <div className="space-y-3.5">
          <Combobox
            label="Staff member"
            value={userId}
            onChange={setUserId}
            options={users.map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` }))}
          />

          <Combobox
            label="Outlet"
            value={outletId}
            onChange={setOutletId}
            options={outlets.map((o) => ({ value: String(o.id), label: o.name }))}
          />

          <Select
            label="Branch role"
            value={branchRoleId}
            onChange={(e) => setBranchRoleId(e.target.value)}
            required
          >
            {branchRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex justify-end gap-2 mt-5 pb-6 sticky bottom-0 bg-white dark:bg-zinc-900">
          <Button type="button" variant="secondary" onClick={requestClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={saving || !users.length || !outlets.length || !branchRoles.length}
            loading={saving}
          >
            {saving ? "Saving…" : "Assign"}
          </Button>
        </div>
      </form>
      )}
    </Modal>
  );
}
