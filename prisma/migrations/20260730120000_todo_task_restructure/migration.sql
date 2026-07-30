-- Todo/Task restructure, tracker manual overrides and tracker config.
--
-- TodoStatus values are RENAMED rather than dropped and recreated, so existing
-- rows survive: TODO->OPEN, IN_PROGRESS->IN_PROCESS, DONE->CLOSED,
-- DEFERRED->HOLD. Postgres rewrites column defaults referencing them too.

ALTER TYPE "TodoStatus" RENAME VALUE 'TODO' TO 'OPEN';
ALTER TYPE "TodoStatus" RENAME VALUE 'IN_PROGRESS' TO 'IN_PROCESS';
ALTER TYPE "TodoStatus" RENAME VALUE 'DONE' TO 'CLOSED';
ALTER TYPE "TodoStatus" RENAME VALUE 'DEFERRED' TO 'HOLD';

-- Task Management uses its own enum so the two systems can diverge later.
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROCESS', 'HOLD', 'CLOSED');

-- To Do gains hold-release scheduling and creator visibility.
ALTER TABLE "todos" ADD COLUMN "holdReleaseDate" TIMESTAMP(3);
ALTER TABLE "todos" ADD COLUMN "isShared" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "todos_status_holdReleaseDate_idx" ON "todos"("status", "holdReleaseDate");

-- Tracker manual overrides for the two financial rates.
ALTER TABLE "tracker_entries" ADD COLUMN "netCollectionRateManual" DECIMAL(6,4);
ALTER TABLE "tracker_entries" ADD COLUMN "paymentEfficiencyManual" DECIMAL(6,4);

-- Owner-editable scoring configuration.
CREATE TABLE "tracker_config" (
    "id" TEXT NOT NULL,
    "configKey" TEXT NOT NULL,
    "configValue" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tracker_config_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tracker_config_configKey_key" ON "tracker_config"("configKey");
ALTER TABLE "tracker_config" ADD CONSTRAINT "tracker_config_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Task Management tables.
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "practiceId" TEXT,
    "createdById" TEXT NOT NULL,
    "assignedToId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "estimatedMinutes" INTEGER,
    "priority" "TodoPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "holdReleaseDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "isVisibleToCreator" BOOLEAN NOT NULL DEFAULT true,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tasks_assignedToId_status_dueDate_idx" ON "tasks"("assignedToId", "status", "dueDate");
CREATE INDEX "tasks_createdById_idx" ON "tasks"("createdById");
CREATE INDEX "tasks_practiceId_idx" ON "tasks"("practiceId");
CREATE INDEX "tasks_status_holdReleaseDate_idx" ON "tasks"("status", "holdReleaseDate");

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_practiceId_fkey"
  FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completedById_fkey"
  FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "task_notes" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "statusChangedTo" "TaskStatus",
    "addedById" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_notes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "task_notes_taskId_addedAt_idx" ON "task_notes"("taskId", "addedAt");

ALTER TABLE "task_notes" ADD CONSTRAINT "task_notes_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_notes" ADD CONSTRAINT "task_notes_addedById_fkey"
  FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
