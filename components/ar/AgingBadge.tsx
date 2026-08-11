import {
  isNotActionable,
  NOT_ACTIONABLE_LABEL,
  NOT_ACTIONABLE_MAX_DAYS,
} from "@/lib/ar-actionable";
import { agingBadgeClasses } from "@/lib/ar-aging";
import { cn } from "@/lib/utils";

/**
 * A claim's age.
 *
 * Under 30 days the badge goes grey and says so on hover: the claim is not
 * yet workable, which is a different thing from being in good shape. Pass
 * `withLabel` where there is room to spell it out — the batch claim list does,
 * a dense queue row does not.
 */
export function AgingBadge({
  days,
  withLabel = false,
}: {
  days: number;
  withLabel?: boolean;
}) {
  const notActionable = isNotActionable({ agingDays: days });

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 tabular-nums ring-1 ring-inset",
          agingBadgeClasses(days),
        )}
        title={
          notActionable
            ? `${NOT_ACTIONABLE_LABEL} — insurance has not had time to process a claim under ${NOT_ACTIONABLE_MAX_DAYS} days old.`
            : undefined
        }
      >
        {days}d
      </span>
      {notActionable && withLabel ? (
        <span className="whitespace-nowrap text-[10px] leading-3 text-slate-500">
          {NOT_ACTIONABLE_LABEL}
        </span>
      ) : null}
    </span>
  );
}
