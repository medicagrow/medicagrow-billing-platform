import { StatusCategory } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";

const CATEGORY_CLASSES: Record<StatusCategory, string> = {
  GREEN: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  BLUE: "bg-sky-50 text-sky-700 ring-sky-200",
  RED: "bg-red-50 text-red-700 ring-red-200",
};

export function StatusBadge({
  label,
  category,
  className,
}: {
  label: string;
  category: StatusCategory;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 ring-1 ring-inset",
        CATEGORY_CLASSES[category],
        className,
      )}
    >
      {label}
    </span>
  );
}

/** Green / Red / Blue proportion pills for a batch summary bar. */
export function CategoryPills({
  green,
  red,
  blue,
}: {
  green: number;
  red: number;
  blue: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
        {green}% green
      </span>
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-200">
        {red}% red
      </span>
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 ring-1 ring-inset ring-sky-200">
        {blue}% blue
      </span>
    </div>
  );
}
