"use client";

import { useEffect, useRef } from "react";
import { TimeBlockType } from "@/lib/generated/prisma/enums";

/** One minute is one pixel, so an hour row is 60px tall. */
export const MINUTE_PX = 1;
export const HOUR_PX = 60 * MINUTE_PX;
export const DAY_MINUTES = 24 * 60;

/** Where the grid scrolls to on load — morning, without hiding the night. */
const DEFAULT_SCROLL_HOUR = 7;

export const BLOCK_COLORS: Record<TimeBlockType, string> = {
  FIXED: "bg-sky-500",
  TODO_WORK: "bg-emerald-500",
  BREAK: "bg-slate-400",
  MEETING: "bg-violet-500",
};

export interface ScheduleBlock {
  id: string;
  startTime: string;
  endTime: string;
  label: string;
  blockType: TimeBlockType;
  isOverride?: boolean;
  overridesBlockId?: string | null;
  specificDate?: string | null;
}

export const toMinutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  return hour * 60 + minute;
};

/**
 * One block can produce two segments.
 *
 * A block ending before it starts has crossed midnight — 23:00–00:30 is a
 * night shift, not an invalid range. It renders as one segment running to the
 * end of the day and another from the top, each labelled so the two read as
 * one block rather than two unrelated ones.
 */
export interface Segment {
  key: string;
  block: ScheduleBlock;
  top: number;
  height: number;
  continuesAfter: boolean;
  continuedFrom: boolean;
}

export function segmentsFor(block: ScheduleBlock): Segment[] {
  const start = toMinutes(block.startTime);
  const end = toMinutes(block.endTime);

  if (end > start) {
    return [
      {
        key: block.id,
        block,
        top: start * MINUTE_PX,
        height: Math.max(16, (end - start) * MINUTE_PX),
        continuesAfter: false,
        continuedFrom: false,
      },
    ];
  }

  // Crosses midnight. A zero-length block (start === end) is treated the same
  // way rather than rendered as an invisible sliver.
  return [
    {
      key: `${block.id}:tail`,
      block,
      top: start * MINUTE_PX,
      height: Math.max(16, (DAY_MINUTES - start) * MINUTE_PX),
      continuesAfter: true,
      continuedFrom: false,
    },
    {
      key: `${block.id}:head`,
      block,
      top: 0,
      height: Math.max(16, end * MINUTE_PX),
      continuesAfter: false,
      continuedFrom: true,
    },
  ];
}

export function DayScheduleGrid({
  blocks,
  readOnly,
  onEdit,
  onRemove,
}: {
  blocks: ScheduleBlock[];
  readOnly: boolean;
  onEdit: (block: ScheduleBlock) => void;
  onRemove: (block: ScheduleBlock) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Land on the morning without cutting the rest of the day off. Only on
  // mount: re-running would yank the view back while someone is scrolling.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = DEFAULT_SCROLL_HOUR * HOUR_PX;
    }
  }, []);

  return (
    <div
      ref={scrollRef}
      className="relative max-h-[460px] overflow-y-auto rounded-lg bg-slate-50 ring-1 ring-inset ring-slate-200"
    >
      <div
        className="relative"
        style={{ height: `${DAY_MINUTES * MINUTE_PX}px` }}
      >
        {Array.from({ length: 24 }).map((_, hour) => (
          <div
            key={hour}
            className="absolute left-0 right-0 border-t border-slate-200/70"
            style={{ top: `${hour * HOUR_PX}px` }}
          >
            <span className="absolute -top-2 left-1 bg-slate-50 px-1 text-[10px] tabular-nums text-slate-400">
              {String(hour).padStart(2, "0")}:00
            </span>
          </div>
        ))}

        {blocks.flatMap(segmentsFor).map((segment) => (
          <div
            key={segment.key}
            className={`group absolute left-12 right-2 overflow-hidden rounded-md px-2 py-1 text-[11px] text-white shadow-sm ${
              BLOCK_COLORS[segment.block.blockType]
            }`}
            style={{ top: `${segment.top}px`, height: `${segment.height}px` }}
            title={`${segment.block.startTime}–${segment.block.endTime} ${segment.block.label}`}
          >
            <span className="block truncate font-medium">
              {segment.continuedFrom ? "← continued " : ""}
              {segment.block.label}
              {segment.continuesAfter ? " continues →" : ""}
            </span>
            <span className="block truncate opacity-90">
              {segment.block.startTime}–{segment.block.endTime}
            </span>

            {/* Controls appear on hover so the grid stays readable. The tail
                segment owns them: acting on either edits the same block. */}
            {readOnly || segment.continuedFrom ? null : (
              <span className="absolute right-1 top-1 hidden items-center gap-1 group-hover:flex">
                <button
                  type="button"
                  onClick={() => onEdit(segment.block)}
                  aria-label={`Edit ${segment.block.label} for this day`}
                  className="rounded bg-black/20 px-1 leading-4 hover:bg-black/40"
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(segment.block)}
                  aria-label={`Hide ${segment.block.label} for this day`}
                  className="rounded bg-black/20 px-1 leading-4 hover:bg-black/40"
                >
                  ×
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
