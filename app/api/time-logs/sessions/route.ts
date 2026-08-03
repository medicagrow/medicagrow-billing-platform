import {
  apiErrorResponse,
  paginatedResponse,
  parsePagination,
  requireRole,
} from "@/lib/api-helpers";
import { accessiblePracticeIds } from "@/lib/ar-access";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getTaskLabel } from "@/lib/task/task-label";
import { isOverrun, sessionWhere } from "@/lib/time-analysis";
import { parseTimeLogFilters } from "@/lib/validations/time-logs";
import type { NextRequest } from "next/server";

/** GET /api/time-logs/sessions — the individual timer sessions behind the totals. */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, ["OWNER", "PROJECT_MANAGER"]);
  if (denied) return denied;

  const parsed = parseTimeLogFilters(request.nextUrl.searchParams);

  if ("error" in parsed) {
    return apiErrorResponse(parsed.error, 400);
  }

  // Same practice narrowing as the summary, for the same reason.
  const allowed = await accessiblePracticeIds(session!.user);

  const practiceIds =
    allowed === null
      ? parsed.filters.practiceIds
      : parsed.filters.practiceIds && parsed.filters.practiceIds.length > 0
        ? parsed.filters.practiceIds.filter((id) => allowed.includes(id))
        : allowed;

  const where = sessionWhere({ ...parsed.filters, practiceIds });
  const pagination = parsePagination(request.nextUrl.searchParams);

  const [sessions, total] = await Promise.all([
    prisma.taskTimeLog.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
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
            totalLoggedMinutes: true,
            taskType: { select: { name: true } },
            practice: { select: { name: true } },
          },
        },
      },
    }),
    prisma.taskTimeLog.count({ where }),
  ]);

  return paginatedResponse(
    sessions.map((row) => ({
      id: row.id,
      taskId: row.task.id,
      taskLabel: getTaskLabel(row.task),
      practiceName: row.task.practice?.name ?? null,
      userId: row.user.id,
      userName: row.user.name,
      startedAt: row.startedAt.toISOString(),
      stoppedAt: row.stoppedAt?.toISOString() ?? null,
      durationMinutes: row.durationMinutes,
      isEdited: row.isEdited,
      editNote: row.editNote,
      originalDurationMinutes: row.originalDurationMinutes,
      estimatedMinutes: row.task.estimatedMinutes,
      /**
       * Whether the task this session belongs to is over budget. Judged on the
       * task's whole logged total, not this session alone — a 10-minute
       * session is not itself an overrun, but it may be the one that tipped
       * the task past its estimate.
       */
      contributedToOverrun: isOverrun(
        row.task.totalLoggedMinutes,
        row.task.estimatedMinutes,
      ),
    })),
    total,
    pagination,
  );
}
