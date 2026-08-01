import { NextResponse, type NextRequest } from "next/server";
import { TaskStatus } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  paginatedResponse,
  parsePagination,
  requireAuth,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAssignTask, taskVisibilityFilter } from "@/lib/task-access";
import { TASK_INCLUDE, toTaskDto } from "@/lib/task-serialize";
import { generateInitialInstances } from "@/lib/task/recurrence";
import { dayStart } from "@/lib/todo/access";
import { createTaskSchema, listTasksQuerySchema } from "@/lib/validations/task";

const OPEN_STATUSES = [TaskStatus.OPEN, TaskStatus.IN_PROCESS];

/** Occurrences generated up front when a recurring task is created. */
const INITIAL_INSTANCES = 3;

/** GET /api/tasks — visibility-scoped, filtered, paginated. */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const searchParams = request.nextUrl.searchParams;

  const query = listTasksQuerySchema.safeParse({
    assignedToId: searchParams.get("assignedToId") ?? undefined,
    createdById: searchParams.get("createdById") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    priority: searchParams.get("priority") ?? undefined,
    practiceId: searchParams.get("practiceId") ?? undefined,
    taskTypeId: searchParams.get("taskTypeId") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    tag: searchParams.get("tag") ?? undefined,
    recurringOnly: searchParams.get("recurringOnly") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    overdue: searchParams.get("overdue") ?? undefined,
    sort: searchParams.get("sort") ?? undefined,
    direction: searchParams.get("direction") ?? undefined,
  });

  if (!query.success) {
    return zodErrorResponse(query.error);
  }

  const filters = query.data;
  const pagination = parsePagination(searchParams);

  const dateRange =
    filters.from || filters.to
      ? {
          ...(filters.from ? { gte: dayStart(filters.from) } : {}),
          ...(filters.to
            ? { lte: new Date(dayStart(filters.to).getTime() + 86_399_999) }
            : {}),
        }
      : undefined;

  const where = {
    ...(await taskVisibilityFilter(session!.user)),
    ...(filters.assignedToId ? { assignedToId: filters.assignedToId } : {}),
    ...(filters.createdById ? { createdById: filters.createdById } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.practiceId ? { practiceId: filters.practiceId } : {}),
    ...(filters.taskTypeId ? { taskTypeId: filters.taskTypeId } : {}),
    ...(filters.search
      ? { title: { contains: filters.search, mode: "insensitive" as const } }
      : {}),
    ...(filters.tag ? { tags: { has: filters.tag } } : {}),
    // A recurring series is the parent plus everything it generated.
    ...(filters.recurringOnly === "true"
      ? { OR: [{ isRecurring: true }, { parentTaskId: { not: null } }] }
      : {}),
    ...(dateRange ? { dueDate: dateRange } : {}),
    ...(filters.overdue === "true"
      ? { dueDate: { lt: dayStart() }, status: { in: OPEN_STATUSES } }
      : {}),
  };

  const direction = filters.direction ?? "asc";

  const orderBy =
    filters.sort === "priority"
      ? [{ priority: direction }]
      : filters.sort === "title"
        ? [{ title: direction }]
        : filters.sort === "status"
          ? [{ status: direction }]
          : filters.sort === "createdAt"
            ? [{ createdAt: direction }]
            : [{ dueDate: { sort: direction, nulls: "last" as const } }];

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: [...orderBy, { createdAt: "asc" }],
      skip: pagination.skip,
      take: pagination.take,
      include: TASK_INCLUDE,
    }),
    prisma.task.count({ where }),
  ]);

  return paginatedResponse(tasks.map(toTaskDto), total, pagination);
}

/** POST /api/tasks — create and assign work. */
export async function POST(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const body = createTaskSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const input = body.data;

  if (!(await canAssignTask(session!.user, input.assignedToId))) {
    return apiErrorResponse("You cannot assign tasks to that person.", 403);
  }

  const task = await prisma.task.create({
    data: {
      description: input.description ?? null,
      practiceId: input.practiceId ?? null,
      taskTypeId: input.taskTypeId ?? null,
      createdById: session!.user.id,
      assignedToId: input.assignedToId,
      // A recurring parent is a template, not work: its own due date stays
      // empty and the instances carry the dates.
      dueDate:
        input.isRecurring || !input.dueDate ? null : dayStart(input.dueDate),
      estimatedMinutes: input.estimatedMinutes ?? null,
      priority: input.priority,
      status: input.status,
      holdReleaseDate: input.holdReleaseDate
        ? dayStart(input.holdReleaseDate)
        : null,
      isVisibleToCreator: input.isVisibleToCreator,
      isRecurring: input.isRecurring,
      recurringConfig: input.recurringConfig ?? undefined,
      tags: input.tags,
    },
    include: TASK_INCLUDE,
  });

  // Seeding the first few occurrences makes the series visible in planning
  // views straight away instead of appearing one at a time.
  const instances = input.isRecurring
    ? await generateInitialInstances(task as never, INITIAL_INSTANCES)
    : [];

  return NextResponse.json(
    { task: toTaskDto(task), generatedInstances: instances.length },
    { status: 201 },
  );
}
