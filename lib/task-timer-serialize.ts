import type {
  TimeEditRequestStatus,
  TimerReviewStatus,
} from "@/lib/generated/prisma/enums";

export interface TaskTimeLogDto {
  id: string;
  taskId: string;
  userId: string;
  userName: string | null;
  startedAt: string;
  stoppedAt: string | null;
  durationMinutes: number | null;
  isEdited: boolean;
  originalDurationMinutes: number | null;
  editApprovedByName: string | null;
  editNote: string | null;
  /** Status of the most recent edit request, so the row can show "pending". */
  pendingEditRequestId: string | null;
  /**
   * An auto-stopped session is shown, not hidden: this is where the biller
   * sees what happened and says when they actually stopped. Its hours are
   * excluded from every report until a PM or Owner approves it, so the row
   * has to say so rather than quietly showing a figure nothing else counts.
   */
  autoStopped: boolean;
  reviewStatus: TimerReviewStatus;
  reviewedByName: string | null;
  reviewedAt: string | null;
  billerNote: string | null;
}

type TimeLogRow = {
  id: string;
  taskId: string;
  userId: string;
  startedAt: Date;
  stoppedAt: Date | null;
  durationMinutes: number | null;
  isEdited: boolean;
  originalDurationMinutes: number | null;
  editNote: string | null;
  autoStopped: boolean;
  reviewStatus: TimerReviewStatus;
  reviewedAt: Date | null;
  billerNote: string | null;
  user?: { name: string } | null;
  editApprovedBy?: { name: string } | null;
  reviewedBy?: { name: string } | null;
  editRequests?: { id: string; status: TimeEditRequestStatus }[];
};

export function toTaskTimeLogDto(log: TimeLogRow): TaskTimeLogDto {
  const pending = log.editRequests?.find(
    (request) => request.status === "PENDING",
  );

  return {
    id: log.id,
    taskId: log.taskId,
    userId: log.userId,
    userName: log.user?.name ?? null,
    startedAt: log.startedAt.toISOString(),
    stoppedAt: log.stoppedAt?.toISOString() ?? null,
    durationMinutes: log.durationMinutes,
    isEdited: log.isEdited,
    originalDurationMinutes: log.originalDurationMinutes,
    editApprovedByName: log.editApprovedBy?.name ?? null,
    editNote: log.editNote,
    pendingEditRequestId: pending?.id ?? null,
    autoStopped: log.autoStopped,
    reviewStatus: log.reviewStatus,
    reviewedByName: log.reviewedBy?.name ?? null,
    reviewedAt: log.reviewedAt?.toISOString() ?? null,
    billerNote: log.billerNote,
  };
}

export const TIME_LOG_INCLUDE = {
  user: { select: { name: true } },
  editApprovedBy: { select: { name: true } },
  reviewedBy: { select: { name: true } },
  editRequests: {
    orderBy: { createdAt: "desc" as const },
    select: { id: true, status: true },
  },
} as const;

/** "2h 15m", or "0m" when nothing is logged. */
export function formatMinutes(total: number | null | undefined): string {
  const minutes = total ?? 0;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
