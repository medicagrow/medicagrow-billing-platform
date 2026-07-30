import type { TimeBlock } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { dayEnd, dayStart } from "@/lib/todo/access";

/**
 * Resolving a day's schedule.
 *
 * A weekly template block repeats on its weekday. A specific-date row either
 * stands alone (a one-off block) or points at a template block via
 * `overridesBlockId`, in which case it replaces that block for that date —
 * or removes it entirely when `isHidden` is set.
 *
 * Editing today therefore never rewrites the weekly plan, which is the whole
 * point: a schedule people cannot adjust for one day gets abandoned.
 */

export interface ResolvedBlock {
  id: string;
  dayOfWeek: number | null;
  specificDate: string | null;
  startTime: string;
  endTime: string;
  label: string;
  blockType: TimeBlock["blockType"];
  color: string | null;
  /** True when this row only applies to the date being viewed. */
  isOverride: boolean;
  /** The template block this replaces, when it is an override. */
  overridesBlockId: string | null;
}

function toResolved(block: TimeBlock, isOverride: boolean): ResolvedBlock {
  return {
    id: block.id,
    dayOfWeek: block.dayOfWeek,
    specificDate: block.specificDate?.toISOString() ?? null,
    startTime: block.startTime,
    endTime: block.endTime,
    label: block.label,
    blockType: block.blockType,
    color: block.color,
    isOverride,
    overridesBlockId: block.overridesBlockId,
  };
}

/** The blocks that actually apply on one date, in start-time order. */
export async function resolveDaySchedule(
  userId: string,
  date: Date,
): Promise<ResolvedBlock[]> {
  const start = dayStart(date.toISOString().slice(0, 10));

  const [weekly, dated] = await Promise.all([
    prisma.timeBlock.findMany({
      where: {
        userId,
        isActive: true,
        dayOfWeek: start.getUTCDay(),
        specificDate: null,
      },
      orderBy: { startTime: "asc" },
    }),
    prisma.timeBlock.findMany({
      where: {
        userId,
        isActive: true,
        specificDate: { gte: start, lte: dayEnd(start) },
      },
      orderBy: { startTime: "asc" },
    }),
  ]);

  const overriddenIds = new Set(
    dated
      .map((block) => block.overridesBlockId)
      .filter((id): id is string => id !== null),
  );

  const resolved: ResolvedBlock[] = [
    // Template blocks the day has not touched.
    ...weekly
      .filter((block) => !overriddenIds.has(block.id))
      .map((block) => toResolved(block, false)),
    // Replacements and one-offs. A hidden override contributes nothing — it
    // exists purely to suppress the template block.
    ...dated
      .filter((block) => !block.isHidden)
      .map((block) => toResolved(block, true)),
  ];

  return resolved.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/** True when the date carries any override, i.e. "restore defaults" would do something. */
export async function hasOverrides(
  userId: string,
  date: Date,
): Promise<boolean> {
  const start = dayStart(date.toISOString().slice(0, 10));

  const count = await prisma.timeBlock.count({
    where: {
      userId,
      specificDate: { gte: start, lte: dayEnd(start) },
      overridesBlockId: { not: null },
    },
  });

  return count > 0;
}
