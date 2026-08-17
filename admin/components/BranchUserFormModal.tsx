"use client";

import { useState, type FormEvent } from "react";
import { createBranchUser } from "@/lib/api";
import { STAFF_ROLE_LABELS, type Outlet, type UserRole } from "@/lib/types";
import Button from "@/components/ui/Button";
import Checkbox from "@/components/ui/Checkbox";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import Combobox from "@/components/ui/Combobox";
import { useToast } from "@/components/ui/Toast";

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
      <Modal
        onClose={onClose}
        size="sm"
        title="Invite sent"
        footer={(requestClose) => (
          <Button type="button" variant="primary" onClick={requestClose}>
            Done
          </Button>
        )}
      >
        <p className="text-sm text-text-secondary dark:text-zinc-400">
          {invited.email} will receive an email with a link to set their own password and activate the account.
        </p>
        {invited.devInviteLink && (
          <p className="text-xs text-text-faint break-all mt-3">
            Dev-only (no email sending yet):{" "}
            <a href={invited.devInviteLink} className="text-accent hover:underline">
              {invited.devInviteLink}
            </a>
          </p>
        )}
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} size="sm" title="New staff account">
      {(requestClose) => (
      <form onSubmit={handleSubmit}>
        <p className="text-sm text-text-muted -mt-2 mb-4">
          A real, separate login for this staff member. The role picked below decides what they can
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
          <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {STAFF_ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
          {needsOutlet && (
            <div>
              <Combobox
                label="Outlet"
                value={outletId}
                onChange={setOutletId}
                options={outlets.map((o) => ({ value: String(o.id), label: o.name }))}
              />
              <p className="mt-1.5 text-xs text-text-faint">
                Scoped to this outlet only. Can&apos;t see or manage any other branch&apos;s orders or inventory.
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
            <p className="text-xs text-text-faint">
              An invite link will be emailed to this address so they can set their own password.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5 pb-6 sticky bottom-0 bg-surface dark:bg-zinc-900">
          <Button type="button" variant="secondary" onClick={requestClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving || (needsOutlet && outlets.length === 0)} loading={saving}>
            {saving ? "Saving…" : setPasswordDirectly ? "Create account" : "Send invite"}
          </Button>
        </div>
      </form>
      )}
    </Modal>
  );
}
