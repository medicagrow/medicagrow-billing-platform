import { NextResponse, type NextRequest } from "next/server";
import {
  apiErrorResponse,
  paginatedResponse,
  parsePagination,
  requireAuth,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import {
  createTaskTypeSchema,
  listTaskTypesQuerySchema,
} from "@/lib/validations/task-type";

/**
 * GET /api/task-types — the list behind every task type picker.
 *
 * Any signed-in role may read it; only owners may change it.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const query = listTaskTypesQuerySchema.safeParse({
    activeOnly: request.nextUrl.searchParams.get("activeOnly") ?? undefined,
  });

  if (!query.success) {
    return zodErrorResponse(query.error);
  }

  const pagination = parsePagination(request.nextUrl.searchParams);

  const where =
    query.data.activeOnly === "true" ? { isActive: true } : {};

  const [taskTypes, total] = await Promise.all([
    prisma.taskType.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.taskType.count({ where }),
  ]);

  return paginatedResponse(taskTypes, total, pagination);
}

/** POST /api/task-types — owner only. */
export async function POST(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, ["OWNER"]);
  if (denied) return denied;

  const body = createTaskTypeSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const existing = await prisma.taskType.findUnique({
    where: { name: body.data.name },
    select: { id: true },
  });

  if (existing) {
    return apiErrorResponse("A task type with that name already exists.", 409);
  }

  const taskType = await prisma.taskType.create({ data: body.data });

  return NextResponse.json({ taskType }, { status: 201 });
}
