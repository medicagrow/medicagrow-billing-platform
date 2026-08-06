"use client";

import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";

/**
 * Paging for every list in the app.
 *
 * Previous/Next alone tells you nothing about where you are in a 40-page
 * batch, and reaching page 30 took 29 clicks. This shows the shape of the
 * list — first pages, last pages, and a window around where you are — so any
 * page is one click away and the ends are always reachable.
 */

/** How many pages the elided form keeps at each end and around the cursor. */
const EDGE_PAGES = 2;
const AROUND_CURRENT = 1;

/** Beyond this many pages, the list is elided rather than listed in full. */
const MAX_UNELIDED = 7;

export const PAGE_SIZE_OPTIONS = [50, 100, 200, 500];

/**
 * Guard for a stored page size. A value that is no longer offered — from an
 * older build, or a hand-edited localStorage entry — falls back to the default
 * rather than being sent to an API that would reject it.
 */
export function isPageSize(value: unknown): value is number {
  return typeof value === "number" && PAGE_SIZE_OPTIONS.includes(value);
}

/** A page number to show, or a gap where pages were skipped. */
type PageSlot = number | "gap";

/**
 * The page numbers to render.
 *
 * Exported for its own test: the elision is the part with the edge cases —
 * a gap of exactly one page is filled rather than elided, since "…" standing
 * in for a single number is both longer and less useful than the number.
 */
export function pageSlots(currentPage: number, totalPages: number): PageSlot[] {
  if (totalPages <= MAX_UNELIDED) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const shown = new Set<number>();

  for (let page = 1; page <= EDGE_PAGES; page += 1) shown.add(page);
  for (let page = totalPages - EDGE_PAGES + 1; page <= totalPages; page += 1) {
    shown.add(page);
  }

  for (
    let page = currentPage - AROUND_CURRENT;
    page <= currentPage + AROUND_CURRENT;
    page += 1
  ) {
    if (page >= 1 && page <= totalPages) shown.add(page);
  }

  const pages = Array.from(shown).sort((a, b) => a - b);
  const slots: PageSlot[] = [];

  for (const [index, page] of pages.entries()) {
    const previous = pages[index - 1];

    if (previous !== undefined && page - previous > 1) {
      // One missing page is shown rather than elided — "…" for a single
      // number is wider than the number and hides a click.
      if (page - previous === 2) slots.push(page - 1);
      else slots.push("gap");
    }

    slots.push(page);
  }

  return slots;
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  /** "claims", "entries", "tasks" — what the numbers are counting. */
  noun = "results",
  /** Says "matching" in the count when the list is filtered. */
  filtered = false,
}: {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  noun?: string;
  filtered?: boolean;
}) {
  const first = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const last = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
      <div className="flex flex-wrap items-center gap-4">
        <span className="tabular-nums">
          {totalItems === 0
            ? `No ${filtered ? "matching " : ""}${noun}`
            : `Showing ${first}–${last} of ${totalItems} ${filtered ? "matching " : ""}${noun}`}
        </span>

        {onPageSizeChange ? (
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Show
            <Select
              value={String(pageSize)}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className="w-auto py-1 text-xs"
              aria-label="Results per page"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </Select>
            per page
          </label>
        ) : null}
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            className="px-2.5 py-1 text-xs"
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
          >
            Previous
          </Button>

          {pageSlots(currentPage, totalPages).map((slot, index) =>
            slot === "gap" ? (
              <span
                key={`gap-${index}`}
                aria-hidden
                className="px-1 text-xs text-slate-400"
              >
                …
              </span>
            ) : (
              <button
                key={slot}
                type="button"
                onClick={() => onPageChange(slot)}
                aria-current={slot === currentPage ? "page" : undefined}
                aria-label={`Page ${slot}`}
                className={cn(
                  "min-w-[2rem] rounded-md px-2 py-1 text-xs font-medium tabular-nums",
                  slot === currentPage
                    ? "bg-brand-600 text-white"
                    : "text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-50",
                )}
              >
                {slot}
              </button>
            ),
          )}

          <Button
            variant="secondary"
            className="px-2.5 py-1 text-xs"
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
