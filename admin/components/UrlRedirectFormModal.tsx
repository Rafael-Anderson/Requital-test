"use client";

import { useState } from "react";
import { createUrlRedirect, updateUrlRedirect } from "@/lib/api";
import type { UrlRedirect } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import Toggle from "@/components/ui/Toggle";
import { useToast } from "@/components/ui/Toast";

// `redirect` edits an existing row; `initialFrom` pre-fills a new one (the
// "create redirect from this" action on a 404 report row).
export default function UrlRedirectFormModal({
  redirect,
  initialFrom,
  onClose,
  onSaved,
}: {
  redirect: UrlRedirect | null;
  initialFrom?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fromPath, setFromPath] = useState(redirect?.fromPath ?? initialFrom ?? "");
  const [toTarget, setToTarget] = useState(redirect?.toTarget ?? "");
  const [statusCode, setStatusCode] = useState<301 | 302>(redirect?.statusCode ?? 301);
  const [active, setActive] = useState(redirect?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const data = { fromPath: fromPath.trim(), toTarget: toTarget.trim(), statusCode, active };
      if (redirect) await updateUrlRedirect(redirect.id, data);
      else await createUrlRedirect(data);
      toast(redirect ? "Redirect updated" : "Redirect created");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save redirect");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} size="sm" title={redirect ? "Edit redirect" : "New redirect"}>
      {(requestClose) => (
        <form onSubmit={handleSubmit}>
          <div className="space-y-3.5">
            <Input
              label="Old URL path"
              value={fromPath}
              onChange={(e) => setFromPath(e.target.value)}
              placeholder="/products/old-handle"
              required
              tooltip="The path visitors used before. Matching ignores capital letters, a trailing slash and any ?query."
            />
            <Input
              label="Send visitors to"
              value={toTarget}
              onChange={(e) => setToTarget(e.target.value)}
              placeholder="/products/new-handle"
              required
              tooltip="A path on your store, or a full address on your own store domain."
            />
            <Select
              label="Type"
              value={statusCode}
              onChange={(e) => setStatusCode(Number(e.target.value) === 302 ? 302 : 301)}
              tooltip="Permanent (301) tells search engines to move the old page's ranking to the new one. Use temporary (302) only for a short-lived change."
            >
              <option value={301}>Permanent (301)</option>
              <option value={302}>Temporary (302)</option>
            </Select>
            <div className="flex items-center gap-2.5">
              <Toggle checked={active} onChange={setActive} />
              <span className="text-[13px] font-medium text-text-secondary dark:text-zinc-400">Active</span>
            </div>
            {error && <InlineErrorMessage>{error}</InlineErrorMessage>}
          </div>
          <div className="flex justify-end gap-2 mt-5 pb-6 sticky bottom-0 bg-surface dark:bg-zinc-900">
            <Button type="button" variant="secondary" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving} loading={saving}>
              {redirect ? "Save changes" : "Create redirect"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
