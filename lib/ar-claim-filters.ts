import { Role, StatusCategory } from "@/lib/generated/prisma/enums";
import { ACTIONABLE_WHERE, NOT_ACTIONABLE_BUCKET } from "@/lib/ar-actionable";
import { agingBucketFilter } from "@/lib/ar-aging";
import { manuallyReassignedTo } from "@/lib/ar-reassignment";
import { alertClaimWhere, loadAlertContext } from "@/lib/ar/smart-alerts";
import { listClaimsQuerySchema } from "@/lib/validations/ar";
import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * One reading of the claim-list filters, shared by the list and the export.
 *
 * The export's entire job is "the same rows, all of them, as a file". Two
 * copies of this logic would drift the first time a filter was added to one of
 * them, and the drift would be invisible: the export would quietly disagree
 * with the table it was taken from, which is worse than it failing outright.
 */

export type ClaimFilters = ReturnType<
  typeof listClaimsQuerySchema.parse
>;

/** Reads every filter param off a query string. */
export function parseClaimFilters(searchParams: URLSearchParams) {
  return listClaimsQuerySchema.safeParse({
    batchId: searchParams.get("batchId") ?? undefined,
    assignedToId: searchParams.get("assignedToId") ?? undefined,
    unassigned: searchParams.get("unassigned") ?? undefined,
    statusCategory: searchParams.get("statusCategory") ?? undefined,
    statusCategories: searchParams.get("statusCategories") ?? undefined,
    statusLabel: searchParams.get("statusLabel") ?? undefined,
    statusLabels: searchParams.get("statusLabels") ?? undefined,
    insuranceName: searchParams.get("insuranceName") ?? undefined,
    insuranceNames: searchParams.get("insuranceNames") ?? undefined,
    agingBuckets: searchParams.get("agingBuckets") ?? undefined,
    providerNames: searchParams.get("providerNames") ?? undefined,
    dosFrom: searchParams.get("dosFrom") ?? undefined,
    dosTo: searchParams.get("dosTo") ?? undefined,
    visitStatus: searchParams.get("visitStatus") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    sort: searchParams.get("sort") ?? undefined,
    direction: searchParams.get("direction") ?? undefined,
    agingBucket: searchParams.get("agingBucket") ?? undefined,
    overdue: searchParams.get("overdue") ?? undefined,
    assignedToIds: searchParams.get("assignedToIds") ?? undefined,
    includeUnassigned: searchParams.get("includeUnassigned") ?? undefined,
    reassignedToMe: searchParams.get("reassignedToMe") ?? undefined,
    includeNotActionable: searchParams.get("includeNotActionable") ?? undefined,
    howChecked: searchParams.get("howChecked") || undefined,
    alert: searchParams.get("alert") || undefined,
    alertKey: searchParams.get("alertKey") || undefined,
  });
}

/**
 * The Prisma `where` these filters describe.
 *
 * **Every filter needing an OR of its own goes into the `AND: []` array**, not
 * a top-level key. Two filters writing `agingDays` — or `statusCategory`, now
 * that a tab and a multi-select both can — would have the object spread
 * silently drop one of them.
 */
export async function claimListWhere(
  filters: ClaimFilters,
  user: { id: string; role: Role },
  todayUtc: Date,
): Promise<Prisma.ArClaimWhereInput> {
  const agingFilter = filters.agingBucket
    ? agingBucketFilter(filters.agingBucket)
    : undefined;

  // Each selected bucket is a separate agingDays range; a claim qualifying for
  // any of them qualifies. Unrecognised keys drop out rather than matching all.
  const agingBucketRanges = (filters.agingBuckets ?? [])
    .map((key) => agingBucketFilter(key))
    .filter((range): range is NonNullable<typeof range> => range !== undefined)
    .map((range) => ({ agingDays: range }));

  /**
   * Practice access is checked by the caller via `canAccessBatch`. Billers are
   * additionally narrowed to their own claims: they may only work what is
   * assigned to them, so there is no reason to hand them the rest of the
   * batch's patient data. PMs and Owners still see the whole batch.
   *
   * Applied last in the object below so a client-supplied assignedToId cannot
   * widen it.
   */
  const billerScope =
    user.role === Role.BILLER ? { assignedToId: user.id } : {};

  const anyOf: Prisma.ArClaimWhereInput[] = [];

  if (agingBucketRanges.length > 0) anyOf.push({ OR: agingBucketRanges });

  /**
   * 0–30 day claims are excluded unless something says otherwise: the explicit
   * flag, or **selecting the 0–30 aging bucket**, which means the same thing.
   * Without the second, choosing that bucket returns an empty table, which
   * reads as a broken filter rather than as a rule.
   */
  const askedForFreshBucket =
    filters.agingBucket === NOT_ACTIONABLE_BUCKET ||
    (filters.agingBuckets ?? []).includes(NOT_ACTIONABLE_BUCKET);

  if (filters.includeNotActionable !== "true" && !askedForFreshBucket) {
    anyOf.push(ACTIONABLE_WHERE);
  }

  // A provider matches on either field, since the column shows either.
  if (filters.providerNames) {
    anyOf.push({
      OR: [
        { renderingProvider: { in: filters.providerNames } },
        { providerName: { in: filters.providerNames } },
      ],
    });
  }

  /**
   * The status multi-selects live here rather than as top-level keys: the
   * tabs already write a singular `statusCategory`, and the two must narrow
   * each other rather than one replacing the other.
   */
  if (filters.statusCategories?.length) {
    anyOf.push({
      statusCategory: { in: filters.statusCategories as StatusCategory[] },
    });
  }

  if (filters.statusLabels?.length) {
    anyOf.push({ statusLabel: { in: filters.statusLabels } });
  }

  /**
   * The "Assigned To" filter. "Unassigned" is a choice alongside the people,
   * not one of them, so the two combine as an OR: show what nobody holds, or
   * what these people hold, or both.
   */
  const assignees: Prisma.ArClaimWhereInput[] = [];

  if (filters.includeUnassigned === "true") {
    assignees.push({ assignedToId: null });
  }

  if (filters.assignedToIds) {
    assignees.push({ assignedToId: { in: filters.assignedToIds } });
  }

  if (assignees.length > 0) anyOf.push({ OR: assignees });

  /**
   * Claims handed to the caller: a blue status moved it, or a note named them.
   * The second cannot be read from the claim — `assignedToId` says who holds
   * it now, not how it got there — so the note history answers it, in one
   * query for the batch rather than one per claim.
   */
  if (filters.reassignedToMe === "true") {
    const { claimIds } = await manuallyReassignedTo({
      userId: user.id,
      batchId: filters.batchId,
    });

    anyOf.push({
      assignedToId: user.id,
      OR: [{ statusCategory: StatusCategory.BLUE }, { id: { in: claimIds } }],
    });
  }

  if (filters.howChecked) {
    anyOf.push({
      workNotes: {
        some: {
          structuredFields: { path: ["howChecked"], equals: filters.howChecked },
        },
      },
    });
  }

  /**
   * A Smart Alert's claims. The detector owns the condition, so the list and
   * the alert's count cannot disagree about which claims it means.
   */
  if (filters.alert) {
    const context = await loadAlertContext(
      filters.batchId,
      user.role === Role.BILLER ? user.id : undefined,
    );

    anyOf.push(
      context
        ? await alertClaimWhere(filters.alert, filters.alertKey ?? null, context)
        : { id: { in: [] } },
    );
  }

  /**
   * Free text spans the patient, the CPT and the visit id — one box, three
   * places to look. The visit id is how some practices refer to an encounter
   * on the phone, so it belongs in the same box rather than a field of its own.
   */
  if (filters.search) {
    anyOf.push({
      OR: [
        { patientName: { contains: filters.search, mode: "insensitive" } },
        { cptCode: { contains: filters.search, mode: "insensitive" } },
        { visitId: { contains: filters.search, mode: "insensitive" } },
      ],
    });
  }

  /**
   * Dates of service are calendar dates stored at UTC midnight, so both ends
   * of the range are that same midnight and the bounds are inclusive. Passing
   * the YYYY-MM-DD string straight to Prisma would not parse as a DateTime.
   */
  const utcDay = (date: string) => new Date(`${date}T00:00:00.000Z`);

  const dateOfService =
    filters.dosFrom || filters.dosTo
      ? {
          ...(filters.dosFrom ? { gte: utcDay(filters.dosFrom) } : {}),
          ...(filters.dosTo ? { lte: utcDay(filters.dosTo) } : {}),
        }
      : undefined;

  return {
    batchId: filters.batchId,
    ...(anyOf.length > 0 ? { AND: anyOf } : {}),
    ...(dateOfService ? { dateOfService } : {}),
    ...(filters.unassigned === "true" ? { assignedToId: null } : {}),
    ...(filters.assignedToId ? { assignedToId: filters.assignedToId } : {}),
    ...(filters.statusCategory ? { statusCategory: filters.statusCategory } : {}),
    ...(filters.statusLabel ? { statusLabel: filters.statusLabel } : {}),
    ...(filters.visitStatus ? { visitStatus: filters.visitStatus } : {}),
    ...(filters.insuranceNames
      ? { insuranceName: { in: filters.insuranceNames } }
      : {}),
    ...(filters.insuranceName
      ? {
          insuranceName: {
            contains: filters.insuranceName,
            mode: "insensitive" as const,
          },
        }
      : {}),
    ...(agingFilter ? { agingDays: agingFilter } : {}),
    ...(filters.overdue === "true"
      ? {
          statusCategory: StatusCategory.RED,
          followUpDate: { lt: todayUtc },
        }
      : {}),
    ...billerScope,
  };
}
