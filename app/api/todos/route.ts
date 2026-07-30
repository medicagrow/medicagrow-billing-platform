import { NextResponse, type NextRequest } from "next/server";
import { TodoStatus } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  paginatedResponse,
  parsePagination,
  requireAuth,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { TODO_INCLUDE, toTodoDto } from "@/lib/todo-serialize";
import { canAssignTo, dayStart, todoVisibilityFilter } from "@/lib/todo/access";
import {
  GENERATION_WINDOW_DAYS,
  generateInstances,
  parseRecurringConfig,
} from "@/lib/todo/recurrence";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { createTodoSchema, listTodosQuerySchema } from "@/lib/validations/todo";

/** GET /api/todos — visibility-scoped, paginated list. */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const searchParams = request.nextUrl.searchParams;

  const query = listTodosQuerySchema.safeParse({
    assignedToId: searchParams.get("assignedToId") ?? undefined,
    subAssignedToId: searchParams.get("subAssignedToId") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    priority: searchParams.get("priority") ?? undefined,
    practiceId: searchParams.get("practiceId") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    overdue: searchParams.get("overdue") ?? undefined,
    isRecurring: searchParams.get("isRecurring") ?? undefined,
    isShared: searchParams.get("isShared") ?? undefined,
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
    ...todoVisibilityFilter(session!.user),
    ...(filters.assignedToId ? { assignedToId: filters.assignedToId } : {}),
    ...(filters.subAssignedToId
      ? { subAssignedToId: filters.subAssignedToId }
      : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.practiceId ? { practiceId: filters.practiceId } : {}),
    ...(filters.search
      ? { title: { contains: filters.search, mode: "insensitive" as const } }
      : {}),
    ...(filters.isRecurring
      ? { isRecurring: filters.isRecurring === "true" }
      : {}),
    ...(filters.isShared ? { isShared: filters.isShared === "true" } : {}),
    ...(dateRange ? { dueDate: dateRange } : {}),
    ...(filters.overdue === "true"
      ? {
          dueDate: { lt: dayStart() },
          status: { in: [TodoStatus.OPEN, TodoStatus.IN_PROCESS] },
        }
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
          : filters.sort === "assignedTo"
            ? [{ assignedTo: { name: direction } }]
            : [{ dueDate: { sort: direction, nulls: "last" as const } }];

  const [todos, total] = await Promise.all([
    prisma.todo.findMany({
      where,
      orderBy: [
        ...orderBy,
        { priority: "asc" },
        { createdAt: "asc" },
      ],
      skip: pagination.skip,
      take: pagination.take,
      include: TODO_INCLUDE,
    }),
    prisma.todo.count({ where }),
  ]);

  return paginatedResponse(todos.map(toTodoDto), total, pagination);
}

/** POST /api/todos — create a task, expanding recurring series ahead. */
export async function POST(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const body = createTodoSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const input = body.data;

  if (!(await canAssignTo(session!.user, input.assignedToId))) {
    return apiErrorResponse(
      "You cannot assign tasks to that person.",
      403,
    );
  }

  const dueDate = input.dueDate ? dayStart(input.dueDate) : null;

  const todo = await prisma.todo.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      practiceId: input.practiceId ?? null,
      createdById: session!.user.id,
      assignedToId: input.assignedToId,
      subAssignedToId: input.subAssignedToId ?? null,
      dueDate,
      estimatedMinutes: input.estimatedMinutes ?? null,
      priority: input.priority,
      tags: input.tags,
      isRecurring: input.isRecurring,
      recurringConfig: input.recurringConfig ?? undefined,
      isShared: input.isShared,
    },
    include: TODO_INCLUDE,
  });

  // Generate the rest of the series up front so it shows in daily planning.
  let generated = 0;

  if (input.isRecurring && dueDate) {
    const config = parseRecurringConfig(input.recurringConfig);

    if (config) {
      const dates = generateInstances(config, dueDate, GENERATION_WINDOW_DAYS);
      // The first occurrence is the todo just created.
      const rest = dates.filter(
        (date) => date.getTime() !== dueDate.getTime(),
      );

      if (rest.length > 0) {
        const result = await prisma.todo.createMany({
          data: rest.map((date) => ({
            title: input.title,
            description: input.description ?? null,
            practiceId: input.practiceId ?? null,
            createdById: session!.user.id,
            assignedToId: input.assignedToId,
            dueDate: date,
            estimatedMinutes: input.estimatedMinutes ?? null,
            priority: input.priority,
            tags: input.tags,
            isRecurring: false,
            parentTodoId: todo.id,
          })),
        });
        generated = result.count;
      }
    }
  }

  return NextResponse.json(
    { todo: toTodoDto(todo), generatedInstances: generated },
    { status: 201 },
  );
}
