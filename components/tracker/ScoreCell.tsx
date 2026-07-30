import { scoreTone } from "@/lib/tracker/scoring";
import { cn } from "@/lib/utils";

const TONE_CLASSES = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  none: "bg-slate-50 text-slate-400 ring-slate-200",
} as const;

/**
 * A score badge. Null renders as N/A rather than zero — a missing report is
 * not a failing one, and the final score excludes it entirely.
 */
export function ScoreCell({
  score,
  size = "sm",
  className,
}: {
  score: number | null | undefined;
  size?: "sm" | "lg";
  className?: string;
}) {
  const tone = scoreTone(score);

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md font-semibold tabular-nums ring-1 ring-inset",
        size === "lg" ? "px-3 py-1.5 text-lg" : "px-2 py-0.5 text-xs",
        TONE_CLASSES[tone],
        className,
      )}
      title={score === null || score === undefined ? "No data for this measure" : undefined}
    >
      {score === null || score === undefined ? "N/A" : score}
    </span>
  );
}
