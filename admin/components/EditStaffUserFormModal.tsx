"use client";

import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { updateStaffUser } from "@/lib/api";
import { STAFF_ROLE_LABELS, type AuthUser, type Outlet, type UserRole } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

const SELECT_CLASS =
  "flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20";

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

        <h2 className="text-lg font-semibold mb-4">Edit staff account</h2>

        <div className="space-y-3.5">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <p className="text-xs text-zinc-400 -mt-2">{user.email}</p>

          <div>
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className={SELECT_CLASS}>
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {STAFF_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>

          {needsOutlet && (
            <div>
              <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Outlet</label>
              <select value={outletId} onChange={(e) => setOutletId(e.target.value)} required className={SELECT_CLASS}>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving || (needsOutlet && outlets.length === 0)}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </div>
  );
}
