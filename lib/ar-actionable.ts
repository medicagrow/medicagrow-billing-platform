/**
 * "Not yet actionable" — claims aged 30 days or less.
 *
 * Insurance has not had time to process them, so calling about one is a wasted
 * call. They are **not hidden**: they stay in every list, because a PM looking
 * at a batch needs to see the whole book. What they are excluded from is work
 * — the biller queue, bulk assignment, and every completion percentage.
 *
 * Excluding them from a completion rate matters most. A batch uploaded this
 * month is mostly fresh claims; counting them in the denominator makes a team
 * that has worked everything they *could* work look 40% done, which is a
 * number nobody can act on.
 *
 * The flag is **derived, never stored** — `agingDays` is set at import and a
 * stored copy would go stale the moment the definition changed. Free of Prisma
 * so client components can import it.
 */

/** A claim at or under this many days is not yet worth working. */
export const NOT_ACTIONABLE_MAX_DAYS = 30;

export function isNotActionable(claim: { agingDays: number }): boolean {
  return claim.agingDays <= NOT_ACTIONABLE_MAX_DAYS;
}

/**
 * The Prisma fragment that keeps only actionable claims. Spread into a `where`
 * rather than written out at each call site, so the threshold is one edit.
 */
export const ACTIONABLE_WHERE = {
  agingDays: { gt: NOT_ACTIONABLE_MAX_DAYS },
} as const;

/** The complement — used by the "0–30 day" filter option and by counts of it. */
export const NOT_ACTIONABLE_WHERE = {
  agingDays: { lte: NOT_ACTIONABLE_MAX_DAYS },
} as const;

/** The label shown wherever one of these claims is drawn. */
export const NOT_ACTIONABLE_LABEL = "Not yet actionable";

/** The footnote under any figure this rule has narrowed. */
export function excludedNote(count: number): string {
  return `${count} claim${count === 1 ? "" : "s"} in the 0–${NOT_ACTIONABLE_MAX_DAYS} day bucket excluded (not yet actionable)`;
}
