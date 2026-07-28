"use client";

import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { changePassword, resendVerification } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resending, setResending] = useState(false);
  const [devVerificationLink, setDevVerificationLink] = useState<string | null>(null);
  const toast = useToast();

  async function handleResend() {
    setResending(true);
    try {
      const result = await resendVerification();
      toast("Verification email sent");
      // DEV-ONLY: no real email infra exists yet — see backend/src/common/email.ts.
      if (result.devVerificationLink) setDevVerificationLink(result.devVerificationLink);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to resend", "error");
    } finally {
      setResending(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords don't match");
      return;
    }
    setSaving(true);
    try {
      await changePassword({ currentPassword, newPassword });
      toast("Password changed");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
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

        <h2 className="text-lg font-semibold mb-4">Change password</h2>

        {user && !user.emailVerified ? (
          <div className="space-y-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Verify your email before changing your password.
            </p>
            {devVerificationLink && (
              <p className="text-xs text-zinc-400 break-all">
                Dev-only (no email sending yet):{" "}
                <a href={devVerificationLink} className="text-accent hover:underline">
                  {devVerificationLink}
                </a>
              </p>
            )}
            <Button type="button" variant="secondary" onClick={handleResend} disabled={resending}>
              {resending ? "Sending…" : "Resend verification email"}
            </Button>
          </div>
        ) : (
          <>
            {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}

            <div className="space-y-3.5">
              <Input
                label="Current password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
              <Input
                label="New password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
              <Input
                label="Confirm new password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <Button type="button" variant="secondary" onClick={onClose}>
            {user && !user.emailVerified ? "Close" : "Cancel"}
          </Button>
          {(!user || user.emailVerified) && (
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving…" : "Change password"}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
