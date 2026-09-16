import { NextResponse, type NextRequest } from "next/server";
import {
  apiErrorResponse,
  requireAuth,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { canAccessBatch } from "@/lib/ar-access";
import { ACTIONABLE_WHERE } from "@/lib/ar-actionable";
import { claimListWhere, parseClaimFilters } from "@/lib/ar-claim-filters";
import {
  isAnalysisDimension,
  runBatchAnalysis,
} from "@/lib/ar/batch-analysis";
import { startOfTodayUtc } from "@/lib/ar-stats";
import { getSession } from "@/lib/session";

/**
 * GET /api/ar/batches/[batchId]/analysis — the batch pivoted by one dimension,
 * optionally nested by a second.
 *
 * Takes every claim-list filter, through the same parser the list uses, so a
 * click on a pivot cell can land on the list with exactly those claims.
 *
 * **Always excludes 0–30 day claims**, even when the list's own checkbox or a
 * 0–30 aging bucket would let them in: a pivot is a summary, and summaries in
 * this module are over workable claims.
 *
 * `showClaims` / `showBalance` / `showAvgAging` are accepted, but all three
 * measures come back regardless — they cost one grouped query together, and
 * returning them lets the page toggle a column without asking again.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { batchId: string } },
) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  if (!(await canAccessBatch(session!.user, params.batchId))) {
    return apiErrorResponse("Batch not found.", 404);
  }

  const search = new URLSearchParams(request.nextUrl.searchParams);
  search.set("batchId", params.batchId);

  const primary = search.get("primaryDimension");
  const subParam = search.get("subDimension");

  if (!isAnalysisDimension(primary)) {
    return apiErrorResponse("Choose what to group the rows by.", 400);
  }

  const sub = subParam && subParam !== "none" ? subParam : null;

  if (sub !== null && !isAnalysisDimension(sub)) {
    return apiErrorResponse("That sub-row grouping is not recognised.", 400);
  }

  const parsed = parseClaimFilters(search);
  if (!parsed.success) return zodErrorResponse(parsed.error);

  const where = await claimListWhere(
    parsed.data,
    session!.user,
    startOfTodayUtc(),
  );

  const result = await runBatchAnalysis({
    where: { AND: [where, ACTIONABLE_WHERE] },
    primary,
    sub,
  });

  return NextResponse.json(result);
}
