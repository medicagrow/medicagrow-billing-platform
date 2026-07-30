-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "StatusCategory" AS ENUM ('RED', 'BLUE', 'GREEN');

-- CreateEnum
CREATE TYPE "OutcomeType" AS ENUM ('PAID', 'DENIED', 'NO_CLAIM_ON_FILE', 'PATIENT_RESPONSIBILITY', 'IN_PROCESS', 'CHECK_WITH_OFFICE', 'WRITE_OFF', 'OTHER');

-- CreateTable
CREATE TABLE "ar_batches" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "ehrSource" "EhrSource" NOT NULL,
    "reportMonth" INTEGER NOT NULL,
    "reportYear" INTEGER NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'OPEN',
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "targetCompletionDate" TIMESTAMP(3),
    "totalClaims" INTEGER NOT NULL DEFAULT 0,
    "totalBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "insuranceName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ar_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ar_claims" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "patientName" TEXT NOT NULL,
    "patientId" TEXT,
    "insuranceName" TEXT NOT NULL,
    "subscriberId" TEXT,
    "claimNumber" TEXT,
    "dateOfService" TIMESTAMP(3) NOT NULL,
    "cptCode" TEXT,
    "billedAmount" DECIMAL(12,2),
    "insurancePaid" DECIMAL(12,2),
    "patientPaid" DECIMAL(12,2),
    "balance" DECIMAL(12,2) NOT NULL,
    "agingDays" INTEGER NOT NULL,
    "providerName" TEXT,
    "billingProvider" TEXT,
    "renderingProvider" TEXT,
    "location" TEXT,
    "statusCategory" "StatusCategory" NOT NULL DEFAULT 'RED',
    "statusLabel" TEXT NOT NULL DEFAULT 'Pending',
    "assignedToId" TEXT,
    "followUpDate" TIMESTAMP(3),
    "ehrClaimStatus" TEXT,
    "ehrTags" TEXT,
    "lastWorkedAt" TIMESTAMP(3),
    "lastWorkedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ar_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ar_work_notes" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "outcomeType" "OutcomeType" NOT NULL,
    "structuredFields" JSONB NOT NULL,
    "generatedNote" TEXT NOT NULL,
    "additionalNotes" TEXT,
    "statusChangedTo" TEXT NOT NULL,
    "statusCategoryChangedTo" "StatusCategory" NOT NULL,
    "assignedToChangedId" TEXT,
    "followUpDateSet" TIMESTAMP(3),
    "workedById" TEXT NOT NULL,
    "workedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ar_work_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ar_denial_reasons" (
    "id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "ar_denial_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ar_batches_practiceId_status_idx" ON "ar_batches"("practiceId", "status");

-- CreateIndex
CREATE INDEX "ar_batches_status_idx" ON "ar_batches"("status");

-- CreateIndex
CREATE INDEX "ar_batches_reportYear_reportMonth_idx" ON "ar_batches"("reportYear", "reportMonth");

-- CreateIndex
CREATE INDEX "ar_batches_uploadedById_idx" ON "ar_batches"("uploadedById");

-- CreateIndex
CREATE INDEX "ar_batches_closedById_idx" ON "ar_batches"("closedById");

-- CreateIndex
CREATE INDEX "ar_claims_batchId_idx" ON "ar_claims"("batchId");

-- CreateIndex
CREATE INDEX "ar_claims_assignedToId_statusCategory_idx" ON "ar_claims"("assignedToId", "statusCategory");

-- CreateIndex
CREATE INDEX "ar_claims_statusCategory_idx" ON "ar_claims"("statusCategory");

-- CreateIndex
CREATE INDEX "ar_claims_followUpDate_idx" ON "ar_claims"("followUpDate");

-- CreateIndex
CREATE INDEX "ar_claims_agingDays_idx" ON "ar_claims"("agingDays");

-- CreateIndex
CREATE INDEX "ar_claims_insuranceName_idx" ON "ar_claims"("insuranceName");

-- CreateIndex
CREATE INDEX "ar_claims_patientName_idx" ON "ar_claims"("patientName");

-- CreateIndex
CREATE INDEX "ar_work_notes_claimId_workedAt_idx" ON "ar_work_notes"("claimId", "workedAt");

-- CreateIndex
CREATE INDEX "ar_work_notes_workedById_workedAt_idx" ON "ar_work_notes"("workedById", "workedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ar_denial_reasons_reason_key" ON "ar_denial_reasons"("reason");

-- CreateIndex
CREATE INDEX "ar_denial_reasons_usageCount_idx" ON "ar_denial_reasons"("usageCount");

-- AddForeignKey
ALTER TABLE "ar_batches" ADD CONSTRAINT "ar_batches_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_batches" ADD CONSTRAINT "ar_batches_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_batches" ADD CONSTRAINT "ar_batches_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_claims" ADD CONSTRAINT "ar_claims_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ar_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_claims" ADD CONSTRAINT "ar_claims_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_claims" ADD CONSTRAINT "ar_claims_lastWorkedById_fkey" FOREIGN KEY ("lastWorkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_work_notes" ADD CONSTRAINT "ar_work_notes_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ar_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_work_notes" ADD CONSTRAINT "ar_work_notes_workedById_fkey" FOREIGN KEY ("workedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_work_notes" ADD CONSTRAINT "ar_work_notes_assignedToChangedId_fkey" FOREIGN KEY ("assignedToChangedId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
