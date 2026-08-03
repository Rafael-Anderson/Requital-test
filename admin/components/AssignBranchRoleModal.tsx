"use client";

import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { assignBranchRole } from "@/lib/api";
import type { AuthUser, BranchRole, Outlet } from "@/lib/types";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

const SELECT_CLASS =
  "flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg bg-white dark:bg-zinc-900 border dark:border-white/10 p-6 relative"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>

        <h2 className="text-lg font-semibold mb-1">Assign branch role</h2>
        <p className="text-sm text-zinc-500 mb-4">
          Overrides this staff member&apos;s access at one specific outlet only — their access at every
          other outlet is unaffected.
        </p>

        <div className="space-y-3.5">
          <div>
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">
              Staff member
            </label>
            <select value={userId} onChange={(e) => setUserId(e.target.value)} className={SELECT_CLASS} required>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Outlet</label>
            <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className={SELECT_CLASS} required>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">
              Branch role
            </label>
            <select
              value={branchRoleId}
              onChange={(e) => setBranchRoleId(e.target.value)}
              className={SELECT_CLASS}
              required
            >
              {branchRoles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={saving || !users.length || !outlets.length || !branchRoles.length}
          >
            {saving ? "Saving…" : "Assign"}
          </Button>
        </div>
      </form>
    </div>
  );
}
