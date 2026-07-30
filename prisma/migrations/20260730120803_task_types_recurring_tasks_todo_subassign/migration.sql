-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "actualMinutes" INTEGER,
ADD COLUMN     "instanceNumber" INTEGER,
ADD COLUMN     "isRecurring" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parentTaskId" TEXT,
ADD COLUMN     "recurringConfig" JSONB,
ADD COLUMN     "taskTypeId" TEXT;

-- AlterTable
ALTER TABLE "time_blocks" ADD COLUMN     "isHidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "overridesBlockId" TEXT;

-- AlterTable
ALTER TABLE "todos" ADD COLUMN     "subAssignedToId" TEXT;

-- CreateTable
CREATE TABLE "task_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_types_name_key" ON "task_types"("name");

-- CreateIndex
CREATE INDEX "task_types_isActive_sortOrder_idx" ON "task_types"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "tasks_parentTaskId_idx" ON "tasks"("parentTaskId");

-- CreateIndex
CREATE INDEX "tasks_taskTypeId_idx" ON "tasks"("taskTypeId");

-- CreateIndex
CREATE INDEX "time_blocks_overridesBlockId_idx" ON "time_blocks"("overridesBlockId");

-- CreateIndex
CREATE INDEX "todos_subAssignedToId_idx" ON "todos"("subAssignedToId");

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_subAssignedToId_fkey" FOREIGN KEY ("subAssignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_taskTypeId_fkey" FOREIGN KEY ("taskTypeId") REFERENCES "task_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_overridesBlockId_fkey" FOREIGN KEY ("overridesBlockId") REFERENCES "time_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
