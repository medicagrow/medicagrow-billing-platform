import { cn } from "@/lib/utils";

/** MedicaGrow mark — a cross growing a leaf. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white",
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 21V11" />
        <path d="M8.5 15H12" />
        <path d="M12 11c0-3 2.2-5.5 5.5-6-.2 3.4-2.3 5.6-5.5 6z" />
        <path d="M12 15.5c-2.6-.4-4.4-2.2-4.6-5 2.6.4 4.3 2.2 4.6 5z" />
        <path d="M9.5 6.5h5" />
        <path d="M12 4v5" />
      </svg>
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-[15px] font-semibold tracking-tight", className)}>
      Medica<span className="text-brand-400">Grow</span>
    </span>
  );
}
