import { agingBadgeClasses } from "@/lib/ar-aging";
import { cn } from "@/lib/utils";

export function AgingBadge({ days }: { days: number }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 tabular-nums ring-1 ring-inset",
        agingBadgeClasses(days),
      )}
    >
      {days}d
    </span>
  );
}
