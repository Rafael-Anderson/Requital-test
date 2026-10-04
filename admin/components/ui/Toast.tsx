"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type ToastType = "success" | "error";
interface ToastAction {
  label: string;
  onClick: () => void;
}
interface ToastOptions {
  action?: ToastAction;
  // Defaults to 3000ms; the delete-with-undo flow (useUndoableDelete) passes
  // a longer window so the action stays clickable long enough to react to.
  duration?: number;
}
interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

type ShowToast = (message: string, type?: ToastType, options?: ToastOptions) => void;

const ToastContext = createContext<ShowToast | null>(null);

const TYPE_STYLES: Record<ToastType, string> = {
  success: "border-s-green-500",
  error: "border-s-red-500",
};

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // Pending auto-dismiss timers, cleared on unmount: one left running fires
  // setToasts after the provider (or, in tests, the whole jsdom window) is gone
  // and surfaces as an unhandled "window is not defined" that fails the run.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback<ShowToast>(
    (message, type = "success", options) => {
      const id = nextId++;
      setToasts((t) => [...t, { id, message, type, action: options?.action }]);
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        dismiss(id);
      }, options?.duration ?? 3000);
      timers.current.add(timer);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {/* bottom-20, not bottom-4 — the product wizard's own sticky footer
          (ProductForm.tsx) sits flush at bottom-0 with its own z-index, and
          a toast at bottom-4 physically covered its primary action button
          for the toast's whole lifetime (a real, confirmed bug, not a
          z-order issue: z-50 already renders above the footer's z-10, the
          toast just needed vertical clearance, not a higher stack). Bumped
          globally rather than conditionally, since every page's toast
          moving up 64px is a small, harmless visual change and a
          page-aware offset would need new plumbing for one call site. */}
      <div className="fixed bottom-20 end-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast-enter flex items-center gap-3 rounded-lg border-s-4 bg-white dark:bg-zinc-900 shadow-lg px-4 py-3 text-sm text-zinc-800 dark:text-zinc-100 border-y border-e border-black/10 dark:border-white/10 ${TYPE_STYLES[t.type]}`}
          >
            <span>{t.message}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
                className="shrink-0 font-medium text-accent-text dark:text-accent underline decoration-transparent hover:decoration-current cursor-pointer"
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
