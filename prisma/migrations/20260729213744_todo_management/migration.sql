-- CreateEnum
CREATE TYPE "TodoPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TodoStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'DEFERRED');

-- CreateEnum
CREATE TYPE "TimeBlockType" AS ENUM ('FIXED', 'TODO_WORK', 'BREAK', 'MEETING');

-- CreateTable
CREATE TABLE "todos" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "practiceId" TEXT,
    "createdById" TEXT NOT NULL,
    "assignedToId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "estimatedMinutes" INTEGER,
    "priority" "TodoPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TodoStatus" NOT NULL DEFAULT 'TODO',
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurringConfig" JSONB,
    "parentTodoId" TEXT,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "todos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "todo_notes" (
    "id" TEXT NOT NULL,
    "todoId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "todo_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_blocks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dayOfWeek" INTEGER,
    "specificDate" TIMESTAMP(3),
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "blockType" "TimeBlockType" NOT NULL DEFAULT 'TODO_WORK',
    "color" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "todos_assignedToId_status_dueDate_idx" ON "todos"("assignedToId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "todos_createdById_idx" ON "todos"("createdById");

-- CreateIndex
CREATE INDEX "todos_practiceId_idx" ON "todos"("practiceId");

-- CreateIndex
CREATE INDEX "todos_dueDate_idx" ON "todos"("dueDate");

-- CreateIndex
CREATE INDEX "todos_parentTodoId_idx" ON "todos"("parentTodoId");

-- CreateIndex
CREATE INDEX "todo_notes_todoId_addedAt_idx" ON "todo_notes"("todoId", "addedAt");

-- CreateIndex
CREATE INDEX "time_blocks_userId_dayOfWeek_idx" ON "time_blocks"("userId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "time_blocks_userId_specificDate_idx" ON "time_blocks"("userId", "specificDate");

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_parentTodoId_fkey" FOREIGN KEY ("parentTodoId") REFERENCES "todos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todo_notes" ADD CONSTRAINT "todo_notes_todoId_fkey" FOREIGN KEY ("todoId") REFERENCES "todos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todo_notes" ADD CONSTRAINT "todo_notes_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
