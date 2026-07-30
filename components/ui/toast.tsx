"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AlertIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 4500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, variant: ToastVariant = "success") => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { id, message, variant }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
      >
        {toasts.map((entry) => (
          <div
            key={entry.id}
            role="status"
            className={cn(
              "pointer-events-auto flex items-start gap-2 rounded-lg px-4 py-3 text-sm shadow-lg ring-1",
              entry.variant === "success" &&
                "bg-white text-slate-800 ring-slate-200",
              entry.variant === "error" && "bg-red-50 text-red-800 ring-red-200",
              entry.variant === "info" && "bg-sky-50 text-sky-800 ring-sky-200",
            )}
          >
            {entry.variant === "success" ? (
              <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full bg-brand-600 text-center text-[10px] font-bold leading-4 text-white">
                ✓
              </span>
            ) : (
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span className="flex-1">{entry.message}</span>
            <button
              type="button"
              onClick={() => dismiss(entry.id)}
              className="shrink-0 text-slate-400 hover:text-slate-700"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }

  return context;
}
