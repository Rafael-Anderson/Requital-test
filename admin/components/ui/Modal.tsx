"use client";

// Shared shell for every modal in the admin, replacing 21 independent
// hand-rolled `fixed inset-0 ... bg-black/40` panels (see CLAUDE.md's Admin
// frontend notes) with one component that gets sizing, scroll, and
// animation right in a single place instead of per-file. Deliberately keeps
// the existing convention it consolidates: the backdrop carries no onClick
// — a modal only ever closes via its own X/Cancel button or Escape, never a
// backdrop click. CommandPalette.tsx is the one documented exception to
// that rule and is not built on this component.
//
// `children` is a render-prop receiving `requestClose` (same pattern as
// DropdownMenu.tsx's `close` callback) — a form's own Cancel/Save button
// calls it instead of the raw `onClose` prop so the exit animation plays
// before the real unmount. A `<form>` wrapping the whole body, with its own
// `sticky bottom-0` action row, is the pattern for anything with a native
// submit button — keeping fields and buttons in one <form> instead of
// splitting the footer into a separate DOM region outside it (which would
// break `type="submit"`). The `footer` prop is only for non-form modals
// (confirm dialogs) that don't need that.
import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import Tooltip from "./Tooltip";

export type ModalSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
};

// Matches globals.css's .modal-out duration — the real unmount (calling the
// caller's onClose) is deferred by this long so the exit animation can play
// first instead of the panel just vanishing.
const EXIT_ANIMATION_MS = 150;

export default function Modal({
  onClose,
  size = "md",
  title,
  children,
  footer,
  bodyClassName = "",
  panelClassName = "",
}: {
  onClose: () => void;
  size?: ModalSize;
  title?: ReactNode;
  children: ReactNode | ((requestClose: () => void) => ReactNode);
  footer?: ReactNode | ((requestClose: () => void) => ReactNode);
  bodyClassName?: string;
  panelClassName?: string;
}) {
  const [closing, setClosing] = useState(false);

  function requestClose() {
    setClosing(true);
  }

  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(onClose, EXIT_ANIMATION_MS);
    return () => clearTimeout(t);
  }, [closing, onClose]);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") requestClose();
    }
    document.addEventListener("keydown", handleEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 ${closing ? "" : "backdrop-in"}`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`flex w-full flex-col rounded-2xl bg-surface dark:bg-zinc-900 border border-border dark:border-white/10 max-h-[90vh] ${
          closing ? "modal-out" : "modal-in"
        } ${SIZE_CLASS[size]} ${panelClassName}`}
      >
        {title !== undefined && (
          <div className="flex items-center justify-between gap-4 p-6 pb-4 shrink-0">
            <h2 className="text-lg font-semibold">{title}</h2>
            <Tooltip label="Close" align="end">
              <button
                type="button"
                onClick={requestClose}
                aria-label="Close"
                className="text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
              >
                <X className="size-5" />
              </button>
            </Tooltip>
          </div>
        )}
        <div
          className={`modal-scroll min-h-0 flex-1 overflow-y-auto px-6 ${title !== undefined ? "pb-6" : "py-6"} ${bodyClassName}`}
        >
          {typeof children === "function" ? children(requestClose) : children}
        </div>
        {footer && (
          <div className="flex shrink-0 justify-end gap-2 p-6 pt-4">
            {typeof footer === "function" ? footer(requestClose) : footer}
          </div>
        )}
      </div>
    </div>
  );
}
