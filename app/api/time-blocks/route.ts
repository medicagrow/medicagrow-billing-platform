import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireAuth,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { dayStart } from "@/lib/todo/access";
import { resolveDaySchedule } from "@/lib/todo/schedule";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { timeBlockSchema } from "@/lib/validations/todo";

/** GET /api/time-blocks — a user's schedule template. Own blocks by default. */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const searchParams = request.nextUrl.searchParams;
  const requestedUserId = searchParams.get("userId") ?? session!.user.id;

  const isManager =
    session!.user.role === Role.OWNER ||
    session!.user.role === Role.PROJECT_MANAGER;

  if (requestedUserId !== session!.user.id && !isManager) {
    return apiErrorResponse("You can only view your own schedule.", 403);
  }

  const date = searchParams.get("date") ?? undefined;

  // With a date, the caller wants what actually applies that day, overrides
  // resolved. Without one, they want the raw rows to manage.
  if (date) {
    const data = await resolveDaySchedule(requestedUserId, dayStart(date));
    return NextResponse.json({ data });
  }

  const scope = searchParams.get("scope");

  const scopeFilter =
    scope === "weekly"
      ? { specificDate: null }
      : scope === "specific"
        ? // One-off blocks only; per-date overrides of a template row are an
          // implementation detail of the day view, not something to manage here.
          { specificDate: { not: null }, overridesBlockId: null }
        : {};

  const blocks = await prisma.timeBlock.findMany({
    where: { userId: requestedUserId, isActive: true, ...scopeFilter },
    orderBy: [{ dayOfWeek: "asc" }, { specificDate: "asc" }, { startTime: "asc" }],
  });

  return NextResponse.json({
    data: blocks.map((block) => ({
      id: block.id,
      userId: block.userId,
      dayOfWeek: block.dayOfWeek,
      specificDate: block.specificDate?.toISOString() ?? null,
      startTime: block.startTime,
      endTime: block.endTime,
      label: block.label,
      blockType: block.blockType,
      color: block.color,
      isActive: block.isActive,
      overridesBlockId: block.overridesBlockId,
      isHidden: block.isHidden,
    })),
  });
}

/** POST /api/time-blocks — add a block to your own schedule. */
export async function POST(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const body = timeBlockSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const input = body.data;

  const block = await prisma.timeBlock.create({
    data: {
      userId: session!.user.id,
      dayOfWeek: input.specificDate ? null : (input.dayOfWeek ?? null),
      specificDate: input.specificDate ? dayStart(input.specificDate) : null,
      startTime: input.startTime,
      endTime: input.endTime,
      label: input.label,
      blockType: input.blockType,
      color: input.color ?? null,
      isActive: input.isActive,
      overridesBlockId: input.overridesBlockId ?? null,
      isHidden: input.isHidden,
    },
  });

  return NextResponse.json({ block }, { status: 201 });
}
