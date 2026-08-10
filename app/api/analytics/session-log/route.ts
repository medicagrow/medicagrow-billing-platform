import { Role } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  paginatedResponse,
  parsePagination,
  requireRole,
} from "@/lib/api-helpers";
import { parseAnalyticsRequest } from "@/lib/analytics/request";
import { sessionWhere } from "@/lib/analytics/shared";
import { flaggedTimeLogIds } from "@/lib/analytics/suspicious-activity";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getTaskLabel } from "@/lib/task/task-label";
import type { NextRequest } from "next/server";

/** Columns a caller may sort by, and how each maps onto the query. */
const SORTS = {
  startedAt: (direction: "asc" | "desc") => ({ startedAt: direction }),
  duration: (direction: "asc" | "desc") => ({ durationMinutes: direction }),
  biller: (direction: "asc" | "desc") => ({ user: { name: direction } }),
  practice: (direction: "asc" | "desc") => ({
    task: { practice: { name: direction } },
  }),
  taskType: (direction: "asc" | "desc") => ({
    task: { taskType: { name: direction } },
  }),
} as const;

/**
 * GET /api/analytics/session-log — every timer session behind the numbers.
 *
 * The rows the other four reports are built from. Anyone questioning a total
 * ends up here, so it carries the whole context of each session rather than
 * making them open the task to find out what it was.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const params = request.nextUrl.searchParams;

  const parsed = await parseAnalyticsRequest(params, session!.user);
  if ("error" in parsed) return apiErrorResponse(parsed.error, 400);

  const flaggedOnly = params.get("flaggedOnly") === "true";
  const editedOnly = params.get("editedOnly") === "true";

  const requestedSort = params.get("sort") ?? "startedAt";
  const direction = params.get("direction") === "asc" ? "asc" : "desc";

  const orderBy = (SORTS[requestedSort as keyof typeof SORTS] ?? SORTS.startedAt)(
    direction,
  );

  const where = {
    ...sessionWhere(parsed.filters),
    ...(editedOnly ? { isEdited: true } : {}),
  };

  /**
   * Flags are derived, so "flagged only" cannot be a database filter. The set
   * is computed for the same window and applied to the page — which is why it
   * is fetched once here rather than per row.
   */
  const flags = await flaggedTimeLogIds(parsed.filters);

  const pagination = parsePagination(params);

  const [rows, total] = await Promise.all([
    prisma.taskTimeLog.findMany({
      where,
      orderBy,
      // A flagged-only view has to filter after the fact, so it reads the
      // whole window and pages in memory; everything else pages in SQL.
      ...(flaggedOnly ? {} : { skip: pagination.skip, take: pagination.take }),
      select: {
        id: true,
        startedAt: true,
        stoppedAt: true,
        durationMinutes: true,
        isEdited: true,
        editNote: true,
        originalDurationMinutes: true,
        user: { select: { id: true, name: true } },
        task: {
          select: {
            id: true,
            title: true,
            estimatedMinutes: true,
            productivityCount: true,
            productivityAmount: true,
            practice: { select: { id: true, name: true } },
            taskType: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.taskTimeLog.count({ where }),
  ]);

  const shaped = rows.map((row) => {
    const flagType = flags.get(row.id) ?? null;

    return {
      id: row.id,
      taskId: row.task.id,
      taskLabel: getTaskLabel(row.task),
      practiceId: row.task.practice?.id ?? null,
      practiceName: row.task.practice?.name ?? null,
      taskTypeName: row.task.taskType?.name ?? null,
      billerId: row.user.id,
      billerName: row.user.name,
      startedAt: row.startedAt.toISOString(),
      stoppedAt: row.stoppedAt?.toISOString() ?? null,
      durationMinutes: row.durationMinutes ?? 0,
      estimatedMinutes: row.task.estimatedMinutes,
      efficiencyRate:
        row.task.estimatedMinutes && row.task.estimatedMinutes > 0
          ? Math.round(
              ((row.durationMinutes ?? 0) / row.task.estimatedMinutes) * 1000,
            ) / 10
          : null,
      productivityCount: row.task.productivityCount,
      productivityAmount: row.task.productivityAmount?.toString() ?? null,
      isEdited: row.isEdited,
      editNote: row.editNote,
      originalDurationMinutes: row.originalDurationMinutes,
      isFlagged: flagType !== null,
      flagType,
    };
  });

  if (!flaggedOnly) {
    return paginatedResponse(shaped, total, pagination);
  }

  const onlyFlagged = shaped.filter((row) => row.isFlagged);

  return paginatedResponse(
    onlyFlagged.slice(pagination.skip, pagination.skip + pagination.take),
    onlyFlagged.length,
    pagination,
  );
}
