import { NextResponse, type NextRequest } from "next/server";
import { apiErrorResponse, requireAuth } from "@/lib/api-helpers";
import { canAccessPractice } from "@/lib/ar-access";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { dateToMonthYear } from "@/lib/validations/tracker";

export async function GET(
  _request: NextRequest,
  { params }: { params: { entryId: string } },
) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const entry = await prisma.trackerEntry.findUnique({
    where: { id: params.entryId },
    include: {
      practice: { select: { id: true, name: true } },
      enteredBy: { select: { name: true } },
      lastUpdatedBy: { select: { name: true } },
      lockedBy: { select: { name: true } },
    },
  });

  if (!entry || !(await canAccessPractice(session!.user, entry.practiceId))) {
    return apiErrorResponse("Entry not found.", 404);
  }

  return NextResponse.json({
    entry: {
      ...entry,
      monthYear: dateToMonthYear(entry.monthYear),
      practiceName: entry.practice.name,
      enteredByName: entry.enteredBy.name,
      lastUpdatedByName: entry.lastUpdatedBy?.name ?? null,
      lockedByName: entry.lockedBy?.name ?? null,
    },
  });
}
