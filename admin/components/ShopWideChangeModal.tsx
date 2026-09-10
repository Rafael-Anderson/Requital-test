"use client";

import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

// Confirmation shown when a save from an OUTLET page is about to change
// settings that apply to the WHOLE shop. See lib/shop-wide-fields.ts for
// which fields those are and why this exists.
//
// Rendered conditionally by the caller (`{changes && <ShopWideChangeModal …>}`),
// matching every other confirm dialog in this app — Modal has no `open` prop.
export default function ShopWideChangeModal({
  outletName,
  changes,
  saving,
  onConfirm,
  onCancel,
}: {
  outletName: string;
  changes: string[];
  saving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title="This changes every outlet"
      size="sm"
      onClose={onCancel}
      footer={(requestClose) => (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={requestClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={onConfirm}>
            Save for all outlets
          </Button>
        </div>
      )}
    >
      <div className="space-y-3 text-sm text-text-secondary dark:text-zinc-300">
        <p>
          You are on <span className="font-semibold">{outletName}</span>, but these settings apply to
          your whole shop. Saving changes them for every outlet, not just this one.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          {changes.map((label) => (
            <li key={label} className="font-medium text-text-primary dark:text-zinc-100">
              {label}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
