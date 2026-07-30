import { NextResponse, type NextRequest } from "next/server";
import {
  apiErrorResponse,
  requireAuth,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { dayEnd, dayStart } from "@/lib/todo/access";
import { timeBlockOverrideSchema } from "@/lib/validations/todo";

/**
 * Per-date changes to the weekly template.
 *
 * POST replaces or hides one template block on one date; DELETE clears every
 * override for a date, restoring the template. The template rows themselves
 * are never touched — adjusting today must not silently reshape every week.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const body = timeBlockOverrideSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const input = body.data;

  // Schedules are personal, so the block being overridden must be the
  // caller's own.
  const template = await prisma.timeBlock.findUnique({
    where: { id: input.blockId },
    select: {
      id: true,
      userId: true,
      startTime: true,
      endTime: true,
      label: true,
      blockType: true,
      color: true,
      specificDate: true,
    },
  });

  if (!template || template.userId !== session!.user.id) {
    return apiErrorResponse("Time block not found.", 404);
  }

  // A one-off block has no template behind it — edit or delete it directly.
  if (template.specificDate !== null) {
    return apiErrorResponse(
      "That block already applies to a single date; edit it directly.",
      400,
    );
  }

  const date = dayStart(input.date);

  const data = {
    userId: session!.user.id,
    dayOfWeek: null,
    specificDate: date,
    startTime: input.startTime ?? template.startTime,
    endTime: input.endTime ?? template.endTime,
    label: input.label ?? template.label,
    blockType: input.blockType ?? template.blockType,
    color: template.color,
    overridesBlockId: template.id,
    isHidden: input.hide,
  };

  // One override per block per date, so a second edit replaces the first.
  const existing = await prisma.timeBlock.findFirst({
    where: {
      userId: session!.user.id,
      overridesBlockId: template.id,
      specificDate: { gte: date, lte: dayEnd(date) },
    },
    select: { id: true },
  });

  const block = existing
    ? await prisma.timeBlock.update({ where: { id: existing.id }, data })
    : await prisma.timeBlock.create({ data });

  return NextResponse.json({ block }, { status: existing ? 200 : 201 });
}

/** DELETE /api/time-blocks/overrides?date=YYYY-MM-DD — restore the template. */
export async function DELETE(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const date = request.nextUrl.searchParams.get("date");

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return apiErrorResponse("A date is required, as YYYY-MM-DD.", 400);
  }

  const start = dayStart(date);

  // Only override rows go: a genuine one-off block for that date is the
  // user's own addition, not something "restore defaults" should discard.
  const removed = await prisma.timeBlock.deleteMany({
    where: {
      userId: session!.user.id,
      specificDate: { gte: start, lte: dayEnd(start) },
      overridesBlockId: { not: null },
    },
  });

  return NextResponse.json({ restored: removed.count });
}
