-- CreateEnum
CREATE TYPE "TimerReviewStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED');

-- AlterTable
ALTER TABLE "task_time_logs" ADD COLUMN     "autoStopped" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoStoppedAt" TIMESTAMP(3),
ADD COLUMN     "billerNote" TEXT,
ADD COLUMN     "reviewStatus" "TimerReviewStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- AlterTable
ALTER TABLE "task_types" ADD COLUMN     "unitRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "task_time_log_adjustments" (
    "id" TEXT NOT NULL,
    "logId" TEXT NOT NULL,
    "oldStoppedAt" TIMESTAMP(3),
    "newStoppedAt" TIMESTAMP(3) NOT NULL,
    "oldDurationMinutes" INTEGER,
    "newDurationMinutes" INTEGER NOT NULL,
    "note" TEXT,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_time_log_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "settingKey" TEXT NOT NULL,
    "settingValue" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("settingKey")
);

-- CreateTable
CREATE TABLE "ref_payer_rule" (
    "id" TEXT NOT NULL,
    "payerName" TEXT NOT NULL,
    "timelyFilingDays" INTEGER NOT NULL DEFAULT 90,
    "notes" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ref_payer_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_time_log_adjustments_logId_changedAt_idx" ON "task_time_log_adjustments"("logId", "changedAt");

-- CreateIndex
CREATE INDEX "task_time_log_adjustments_changedById_idx" ON "task_time_log_adjustments"("changedById");

-- CreateIndex
CREATE UNIQUE INDEX "ref_payer_rule_payerName_key" ON "ref_payer_rule"("payerName");

-- CreateIndex
CREATE INDEX "task_time_logs_reviewStatus_idx" ON "task_time_logs"("reviewStatus");

-- AddForeignKey
ALTER TABLE "task_time_logs" ADD CONSTRAINT "task_time_logs_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_time_log_adjustments" ADD CONSTRAINT "task_time_log_adjustments_logId_fkey" FOREIGN KEY ("logId") REFERENCES "task_time_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_time_log_adjustments" ADD CONSTRAINT "task_time_log_adjustments_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ref_payer_rule" ADD CONSTRAINT "ref_payer_rule_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
