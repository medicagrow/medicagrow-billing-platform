import { NextResponse, type NextRequest } from "next/server";
import { TodoStatus } from "@/lib/generated/prisma/enums";
import { requireAuth } from "@/lib/api-helpers";
import { PRIORITY_RANK, TODO_INCLUDE, toTodoDto } from "@/lib/todo-serialize";
import { dayEnd, dayStart } from "@/lib/todo/access";
import { checkHoldReleasesIfNeeded } from "@/lib/todo/hold-release";
import { dayOverrideCounts, resolveDaySchedule } from "@/lib/todo/schedule";
import { blockMinutes } from "@/lib/validations/todo";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

/**
 * GET /api/todos/today — the caller's plan for one day.
 *
 * Returns the day's tasks alongside the TODO_WORK capacity from their time
 * blocks, so the UI can warn when the plan does not fit the day.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  // Anything whose hold expired must be back in the list before it is read.
  await checkHoldReleasesIfNeeded(session!.user.id);

  const dateParam = request.nextUrl.searchParams.get("date") ?? undefined;
  const start = dayStart(dateParam);
  const end = dayEnd(start);

  const todos = await prisma.todo.findMany({
    where: {
      // A sub-assignee works the todo too, so it belongs on their day.
      OR: [
        { assignedToId: session!.user.id },
        { subAssignedToId: session!.user.id },
      ],
      dueDate: { gte: start, lte: end },
      status: { not: TodoStatus.HOLD },
    },
    include: TODO_INCLUDE,
  });

  // Priority first, then quickest to clear — the order people actually work in.
  const sorted = todos.map(toTodoDto).sort((a, b) => {
    const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (byPriority !== 0) return byPriority;
    return (a.estimatedMinutes ?? 0) - (b.estimatedMinutes ?? 0);
  });

  // The weekly template with this date's per-block overrides applied.
  const [blocks, overrideCounts] = await Promise.all([
    resolveDaySchedule(session!.user.id, start),
    dayOverrideCounts(session!.user.id, start),
  ]);

  const availableMinutes = blocks
    .filter((block) => block.blockType === "TODO_WORK")
    .reduce(
      (total, block) => total + blockMinutes(block.startTime, block.endTime),
      0,
    );

  const plannedMinutes = sorted
    .filter((todo) => todo.status !== TodoStatus.CLOSED)
    .reduce((total, todo) => total + (todo.estimatedMinutes ?? 0), 0);

  return NextResponse.json({
    date: start.toISOString().slice(0, 10),
    hasOverrides: overrideCounts.any,
    hiddenBlockCount: overrideCounts.hidden,
    data: sorted,
    blocks: blocks.map((block) => ({
      id: block.id,
      dayOfWeek: block.dayOfWeek,
      specificDate: block.specificDate,
      startTime: block.startTime,
      endTime: block.endTime,
      label: block.label,
      blockType: block.blockType,
      color: block.color,
      isOverride: block.isOverride,
      overridesBlockId: block.overridesBlockId,
    })),
    capacity: {
      availableMinutes,
      plannedMinutes,
      overCapacity: plannedMinutes > availableMinutes && availableMinutes > 0,
    },
  });
}
