"use client";

import Modal from "@/components/ui/Modal";
import { BLOCK_TYPE_LABELS } from "@/lib/types";

export default function AddBlockModal({
  types,
  onClose,
  onPick,
}: {
  types: string[];
  onClose: () => void;
  onPick: (type: string) => void;
}) {
  return (
    <Modal onClose={onClose} title="Add block" size="md">
      {(requestClose) => (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {types.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                onPick(type);
                requestClose();
              }}
              className="rounded-lg border border-black/10 p-4 text-left text-sm font-medium transition-colors hover:border-accent hover:bg-accent/5 dark:border-white/10"
            >
              {BLOCK_TYPE_LABELS[type] ?? type}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
