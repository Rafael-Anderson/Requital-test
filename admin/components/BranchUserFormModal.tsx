"use client";

import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { createBranchUser } from "@/lib/api";
import { STAFF_ROLE_LABELS, type Outlet, type UserRole } from "@/lib/types";
import Button from "@/components/ui/Button";
import Checkbox from "@/components/ui/Checkbox";
import Input from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

const SELECT_CLASS =
  "flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20";

const ROLE_OPTIONS: UserRole[] = ["branch", "order_manager", "viewer", "admin"];

export default function BranchUserFormModal({
  outlets,
  onClose,
  onSaved,
}: {
  outlets: Outlet[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [setPasswordDirectly, setSetPasswordDirectly] = useState(false);
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("branch");
  const [outletId, setOutletId] = useState(outlets[0] ? String(outlets[0].id) : "");
  const [saving, setSaving] = useState(false);
  // Set once creation succeeds via the invite path — keeps the modal open to
  // surface the dev-only link (no real email infra yet, see
  // backend/src/common/email.ts) instead of closing immediately.
  const [invited, setInvited] = useState<{ email: string; devInviteLink?: string } | null>(null);
  const toast = useToast();

  const needsOutlet = role === "branch";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || (setPasswordDirectly && !password) || (needsOutlet && !outletId)) return;
    setSaving(true);
    try {
      const result = await createBranchUser({
        name,
        email,
        ...(setPasswordDirectly ? { password } : {}),
        role,
        ...(needsOutlet ? { outletId: Number(outletId) } : {}),
      });
      if (setPasswordDirectly) {
        toast(`${STAFF_ROLE_LABELS[role].split(" (")[0]} account created for ${email}`);
        onSaved();
        onClose();
      } else {
        toast(`Invite sent to ${email}`);
        onSaved();
        setInvited({ email, devInviteLink: result.devInviteLink });
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to create account", "error");
    } finally {
      setSaving(false);
    }
  }

  if (invited) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-lg bg-white dark:bg-zinc-900 border dark:border-white/10 p-6 relative"
        >
          <h2 className="text-lg font-semibold mb-2">Invite sent</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {invited.email} will receive an email with a link to set their own password and activate the account.
          </p>
          {invited.devInviteLink && (
            <p className="text-xs text-zinc-400 break-all mt-3">
              Dev-only (no email sending yet):{" "}
              <a href={invited.devInviteLink} className="text-accent hover:underline">
                {invited.devInviteLink}
              </a>
            </p>
          )}
          <div className="flex justify-end mt-5">
            <Button type="button" variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </div>
    );
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

        <h2 className="text-lg font-semibold mb-4">New staff account</h2>
        <p className="text-sm text-zinc-500 mb-4">
          A real, separate login for this staff member — the role picked below decides what they can
          see and do.
        </p>

        <div className="space-y-3.5">
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <div>
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className={SELECT_CLASS}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {STAFF_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          {needsOutlet && (
            <div>
              <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">
                Outlet
              </label>
              <select
                value={outletId}
                onChange={(e) => setOutletId(e.target.value)}
                required
                className={SELECT_CLASS}
              >
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-zinc-400">
                Scoped to this outlet only — can&apos;t see or manage any other branch&apos;s orders or inventory.
              </p>
            </div>
          )}

          <Checkbox
            label="Set a password directly instead of emailing an invite"
            checked={setPasswordDirectly}
            onChange={(e) => setSetPasswordDirectly(e.target.checked)}
          />

          {setPasswordDirectly ? (
            <Input
              label="Password"
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          ) : (
            <p className="text-xs text-zinc-400">
              An invite link will be emailed to this address so they can set their own password.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving || (needsOutlet && outlets.length === 0)}>
            {saving ? "Saving…" : setPasswordDirectly ? "Create account" : "Send invite"}
          </Button>
        </div>
      </form>
    </div>
  );
}
