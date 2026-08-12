"use client";

import Modal from "@/components/ui/Modal";
import { SECTION_TYPES, SECTION_TYPE_LABELS, type ThemeSectionType } from "@/lib/types";

export default function AddSectionModal({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (type: ThemeSectionType) => void;
}) {
  return (
    <Modal onClose={onClose} title="Add section" size="md">
      {(requestClose) => (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SECTION_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                onPick(type);
                requestClose();
              }}
              className="rounded-lg border border-black/10 p-4 text-left text-sm font-medium transition-colors hover:border-accent hover:bg-accent/5 dark:border-white/10"
            >
              {SECTION_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
