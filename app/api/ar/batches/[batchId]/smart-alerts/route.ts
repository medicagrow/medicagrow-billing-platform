import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@/lib/generated/prisma/enums";
import { apiErrorResponse, requireAuth } from "@/lib/api-helpers";
import { canAccessBatch } from "@/lib/ar-access";
import { detectSmartAlerts, loadAlertContext } from "@/lib/ar/smart-alerts";
import { getSession } from "@/lib/session";

/**
 * GET /api/ar/batches/[batchId]/smart-alerts — every alert for a batch, most
 * severe first.
 *
 * Computed on each request from live data rather than stored: an alert about
 * idle claims is only true until somebody works them, and a stored one would
 * keep asking for work already done. A biller sees the claim alerts for their
 * own claims only.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { batchId: string } },
) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  if (!(await canAccessBatch(session!.user, params.batchId))) {
    return apiErrorResponse("Batch not found.", 404);
  }

  const context = await loadAlertContext(
    params.batchId,
    session!.user.role === Role.BILLER ? session!.user.id : undefined,
  );

  if (!context) return apiErrorResponse("Batch not found.", 404);

  const alerts = await detectSmartAlerts(context);

  return NextResponse.json({
    data: alerts,
    summary: {
      total: alerts.length,
      high: alerts.filter((alert) => alert.severity === "HIGH").length,
    },
  });
}
