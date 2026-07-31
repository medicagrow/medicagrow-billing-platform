-- CreateEnum
CREATE TYPE "TimeEditRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "activeTimerStartedAt" TIMESTAMP(3),
ADD COLUMN     "activeTimerUserId" TEXT,
ADD COLUMN     "totalLoggedMinutes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "task_time_logs" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "stoppedAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "isEdited" BOOLEAN NOT NULL DEFAULT false,
    "editRequestedAt" TIMESTAMP(3),
    "editApprovedAt" TIMESTAMP(3),
    "editApprovedById" TEXT,
    "editNote" TEXT,
    "originalDurationMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_time_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_time_edit_requests" (
    "id" TEXT NOT NULL,
    "timeLogId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedNewStartedAt" TIMESTAMP(3) NOT NULL,
    "requestedNewStoppedAt" TIMESTAMP(3) NOT NULL,
    "requestedNewDurationMinutes" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "TimeEditRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_time_edit_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_time_logs_taskId_idx" ON "task_time_logs"("taskId");

-- CreateIndex
CREATE INDEX "task_time_logs_userId_startedAt_idx" ON "task_time_logs"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "task_time_edit_requests_status_createdAt_idx" ON "task_time_edit_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "task_time_edit_requests_timeLogId_idx" ON "task_time_edit_requests"("timeLogId");

-- CreateIndex
CREATE INDEX "task_time_edit_requests_requestedById_idx" ON "task_time_edit_requests"("requestedById");

-- CreateIndex
CREATE INDEX "tasks_activeTimerUserId_idx" ON "tasks"("activeTimerUserId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_activeTimerUserId_fkey" FOREIGN KEY ("activeTimerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_time_logs" ADD CONSTRAINT "task_time_logs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_time_logs" ADD CONSTRAINT "task_time_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_time_logs" ADD CONSTRAINT "task_time_logs_editApprovedById_fkey" FOREIGN KEY ("editApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_time_edit_requests" ADD CONSTRAINT "task_time_edit_requests_timeLogId_fkey" FOREIGN KEY ("timeLogId") REFERENCES "task_time_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_time_edit_requests" ADD CONSTRAINT "task_time_edit_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_time_edit_requests" ADD CONSTRAINT "task_time_edit_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
