import type { TimeLogFilters } from "@/lib/time-analysis";

/**
 * Query parsing for the time-log endpoints.
 *
 * `from`/`to` are required: an unbounded scan of every session ever recorded
 * is not a report anybody asked for, and it would only get slower.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A repeated filter arrives as one comma-separated string. */
function list(value: string | null): string[] | undefined {
  if (!value) return undefined;

  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");

  return parts.length > 0 ? parts : undefined;
}

export type ParsedTimeLogFilters =
  | { filters: TimeLogFilters }
  | { error: string };

export function parseTimeLogFilters(
  searchParams: URLSearchParams,
): ParsedTimeLogFilters {
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !ISO_DATE.test(from)) {
    return { error: "A 'from' date is required, as YYYY-MM-DD." };
  }

  if (!to || !ISO_DATE.test(to)) {
    return { error: "A 'to' date is required, as YYYY-MM-DD." };
  }

  if (from > to) {
    return { error: "The 'from' date must not be after the 'to' date." };
  }

  return {
    filters: {
      from: new Date(`${from}T00:00:00.000Z`),
      // Inclusive of the whole end day, not midnight at its start.
      to: new Date(`${to}T23:59:59.999Z`),
      userIds: list(searchParams.get("userIds")),
      practiceIds: list(searchParams.get("practiceIds")),
      taskTypeIds: list(searchParams.get("taskTypeIds")),
    },
  };
}
