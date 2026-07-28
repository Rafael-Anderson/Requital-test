"use client";

import { createContext, useCallback, useContext, useState } from "react";

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
  success: "border-l-green-500",
  error: "border-l-red-500",
};

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback<ShowToast>(
    (message, type = "success", options) => {
      const id = nextId++;
      setToasts((t) => [...t, { id, message, type, action: options?.action }]);
      setTimeout(() => dismiss(id), options?.duration ?? 3000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast-enter flex items-center gap-3 rounded-lg border-l-4 bg-white dark:bg-zinc-900 shadow-lg px-4 py-3 text-sm text-zinc-800 dark:text-zinc-100 border-y border-r border-black/10 dark:border-white/10 ${TYPE_STYLES[t.type]}`}
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
