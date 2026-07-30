import { cn } from "@/lib/utils";

/** Shared completion thresholds: green ≥80%, amber 40–79%, red <40%. */
export function progressTone(percent: number): "green" | "amber" | "red" {
  if (percent >= 80) return "green";
  if (percent >= 40) return "amber";
  return "red";
}

const BAR_COLORS = {
  green: "bg-emerald-500",
  amber: "bg-amber-400",
  red: "bg-red-500",
} as const;

const TEXT_COLORS = {
  green: "text-emerald-700",
  amber: "text-amber-700",
  red: "text-red-700",
} as const;

export function ProgressBar({
  percent,
  size = "sm",
  className,
}: {
  percent: number;
  size?: "sm" | "lg";
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const tone = progressTone(clamped);

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "overflow-hidden rounded-full bg-slate-100",
        size === "lg" ? "h-3" : "h-1.5",
        className,
      )}
    >
      <div
        className={cn("h-full rounded-full transition-all", BAR_COLORS[tone])}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export function progressTextClass(percent: number) {
  return TEXT_COLORS[progressTone(percent)];
}
