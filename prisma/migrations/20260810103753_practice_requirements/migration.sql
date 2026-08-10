-- CreateTable
CREATE TABLE "practice_requirements" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "taskTypeId" TEXT NOT NULL,
    "monthlyHours" DECIMAL(8,2) NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_flag_dismissals" (
    "id" TEXT NOT NULL,
    "flagKey" TEXT NOT NULL,
    "flagType" TEXT NOT NULL,
    "note" TEXT,
    "dismissedById" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_flag_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "practice_requirements_taskTypeId_idx" ON "practice_requirements"("taskTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "practice_requirements_practiceId_taskTypeId_key" ON "practice_requirements"("practiceId", "taskTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_flag_dismissals_flagKey_key" ON "analytics_flag_dismissals"("flagKey");

-- CreateIndex
CREATE INDEX "analytics_flag_dismissals_flagType_idx" ON "analytics_flag_dismissals"("flagType");

-- AddForeignKey
ALTER TABLE "practice_requirements" ADD CONSTRAINT "practice_requirements_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_requirements" ADD CONSTRAINT "practice_requirements_taskTypeId_fkey" FOREIGN KEY ("taskTypeId") REFERENCES "task_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_requirements" ADD CONSTRAINT "practice_requirements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_requirements" ADD CONSTRAINT "practice_requirements_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_flag_dismissals" ADD CONSTRAINT "analytics_flag_dismissals_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
