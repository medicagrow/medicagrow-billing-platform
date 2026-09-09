import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { canAccessBatch } from "@/lib/ar-access";
import { claimListWhere, parseClaimFilters } from "@/lib/ar-claim-filters";
import { startOfTodayUtc } from "@/lib/ar-stats";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

/**
 * A spreadsheet is not a report. Above this the file stops being something a
 * person opens and starts being a database dump, and the browser has to hold
 * all of it in memory before it can be written.
 */
// Not exported: a route module may only export handlers and Next's own config
// names, and the client reads this back off the response as `limit`.
const MAX_EXPORT_ROWS = 10_000;

/**
 * GET /api/ar/claims/export — every claim matching the current filters.
 *
 * **Owner and PM only.** A biller's claim list is already narrowed to their
 * own work, so an export would hand them nothing they cannot see one row at a
 * time — but a file of patient names is a different thing from a screen of
 * them, and it leaves the building. The role check is on the route, not just
 * the button.
 *
 * Filters are read through the same parser and turned into the same `where`
 * the list uses, so "export what I am looking at" is true by construction
 * rather than by two implementations agreeing.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const query = parseClaimFilters(request.nextUrl.searchParams);

  if (!query.success) {
    return zodErrorResponse(query.error);
  }

  const filters = query.data;

  if (!(await canAccessBatch(session!.user, filters.batchId))) {
    return apiErrorResponse("Batch not found.", 404);
  }

  const where = await claimListWhere(filters, session!.user, startOfTodayUtc());

  const [total, claims] = await Promise.all([
    prisma.arClaim.count({ where }),
    prisma.arClaim.findMany({
      where,
      orderBy: [{ agingDays: "desc" }, { patientName: "asc" }],
      take: MAX_EXPORT_ROWS,
      select: {
        id: true,
        patientName: true,
        dateOfService: true,
        insuranceName: true,
        claimNumber: true,
        cptCode: true,
        visitId: true,
        visitStatus: true,
        renderingProvider: true,
        providerName: true,
        billedAmount: true,
        insurancePaid: true,
        patientPaid: true,
        balance: true,
        agingDays: true,
        statusCategory: true,
        statusLabel: true,
        followUpDate: true,
        lastWorkedAt: true,
        assignedTo: { select: { name: true } },
        lastWorkedBy: { select: { name: true } },
        /**
         * The most recent note, joined here rather than fetched per row. A
         * `take: 1` inside the include is one query for the whole page, where
         * a lookup per claim would be ten thousand.
         */
        workNotes: {
          orderBy: { workedAt: "desc" },
          take: 1,
          select: { generatedNote: true, additionalNotes: true },
        },
      },
    }),
  ]);

  const decimal = (value: unknown) =>
    value === null || value === undefined ? null : String(value);

  return NextResponse.json({
    /** What matched, before the cap — so the client can say what it dropped. */
    total,
    limit: MAX_EXPORT_ROWS,
    truncated: total > MAX_EXPORT_ROWS,
    data: claims.map((claim) => {
      const note = claim.workNotes[0];

      return {
        patientName: claim.patientName,
        dateOfService: claim.dateOfService.toISOString(),
        insuranceName: claim.insuranceName,
        claimNumber: claim.claimNumber,
        cptCode: claim.cptCode,
        visitId: claim.visitId,
        visitStatus: claim.visitStatus,
        // Whichever the claim has — the column in the table shows the same.
        provider: claim.renderingProvider ?? claim.providerName,
        billedAmount: decimal(claim.billedAmount),
        insurancePaid: decimal(claim.insurancePaid),
        patientPaid: decimal(claim.patientPaid),
        balance: decimal(claim.balance) ?? "0.00",
        agingDays: claim.agingDays,
        statusCategory: claim.statusCategory,
        statusLabel: claim.statusLabel,
        assignedToName: claim.assignedTo?.name ?? null,
        followUpDate: claim.followUpDate?.toISOString() ?? null,
        lastWorkedAt: claim.lastWorkedAt?.toISOString() ?? null,
        lastWorkedByName: claim.lastWorkedBy?.name ?? null,
        // The biller's own words when they left any, else the generated text.
        lastNote: note
          ? (note.additionalNotes?.trim() || note.generatedNote)
          : null,
      };
    }),
  });
}
