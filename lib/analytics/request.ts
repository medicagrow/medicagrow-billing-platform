import { accessiblePracticeIds } from "@/lib/ar-access";
import type { Role } from "@/lib/generated/prisma/enums";
import type { AnalyticsFilters } from "@/lib/analytics/shared";

/**
 * Turning a query string into a set of analytics filters.
 *
 * Shared by all five routes so they agree on what `from`, `to` and a
 * comma-separated id list mean — and, more importantly, so the practice
 * narrowing happens exactly once. A PM asking for a practice they do not
 * manage must be answered about the ones they do, not refused and not obliged.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A repeated filter arrives as one comma-separated string. */
export function idList(value: string | null): string[] | undefined {
  if (!value) return undefined;

  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");

  return parts.length > 0 ? parts : undefined;
}

export type ParsedAnalyticsRequest =
  | { filters: AnalyticsFilters }
  | { error: string };

/**
 * `from` and `to` are required: an unbounded scan of every session ever
 * recorded is not a report anybody asked for, and it only gets slower.
 */
export async function parseAnalyticsRequest(
  searchParams: URLSearchParams,
  user: { id: string; role: Role },
): Promise<ParsedAnalyticsRequest> {
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
      billerIds: idList(searchParams.get("billerIds")),
      practiceIds: await narrowPractices(
        idList(searchParams.get("practiceIds")),
        user,
      ),
      taskTypeIds: idList(searchParams.get("taskTypeIds")),
    },
  };
}

/**
 * The requested practices, narrowed to what this person may see.
 *
 * An Owner asking for nothing in particular gets undefined — every practice.
 * A PM asking for nothing gets their own list, so the default is already
 * scoped rather than relying on each report to remember.
 */
export async function narrowPractices(
  requested: string[] | undefined,
  user: { id: string; role: Role },
): Promise<string[] | undefined> {
  const allowed = await accessiblePracticeIds(user);

  if (allowed === null) return requested;

  if (!requested || requested.length === 0) return allowed;

  return requested.filter((id) => allowed.includes(id));
}
