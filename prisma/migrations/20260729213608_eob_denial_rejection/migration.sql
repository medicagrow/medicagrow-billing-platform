-- CreateEnum
CREATE TYPE "EobEntryType" AS ENUM ('DENIAL', 'REJECTION');

-- CreateTable
CREATE TABLE "eob_batches" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "batchDate" TIMESTAMP(3) NOT NULL,
    "batchReference" TEXT,
    "payerName" TEXT NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "postedById" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eob_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eob_entries" (
    "id" TEXT NOT NULL,
    "eobBatchId" TEXT NOT NULL,
    "entryType" "EobEntryType" NOT NULL,
    "patientName" TEXT NOT NULL,
    "claimNumber" TEXT,
    "dateOfService" TIMESTAMP(3) NOT NULL,
    "cptCode" TEXT,
    "billedAmount" DECIMAL(12,2),
    "deniedAmount" DECIMAL(12,2),
    "denialCode" TEXT,
    "denialReason" TEXT NOT NULL,
    "rejectionReason" TEXT,
    "actionRequired" TEXT,
    "statusCategory" "StatusCategory" NOT NULL DEFAULT 'RED',
    "statusLabel" TEXT NOT NULL DEFAULT 'Pending Review',
    "assignedToId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "arClaimId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eob_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eob_work_notes" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "statusChangedTo" TEXT NOT NULL,
    "statusCategoryChangedTo" "StatusCategory" NOT NULL,
    "assignedToChangedId" TEXT,
    "workedById" TEXT NOT NULL,
    "workedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eob_work_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "eob_batches_practiceId_batchDate_idx" ON "eob_batches"("practiceId", "batchDate");

-- CreateIndex
CREATE INDEX "eob_batches_payerName_idx" ON "eob_batches"("payerName");

-- CreateIndex
CREATE INDEX "eob_batches_postedById_idx" ON "eob_batches"("postedById");

-- CreateIndex
CREATE INDEX "eob_entries_eobBatchId_idx" ON "eob_entries"("eobBatchId");

-- CreateIndex
CREATE INDEX "eob_entries_assignedToId_statusCategory_idx" ON "eob_entries"("assignedToId", "statusCategory");

-- CreateIndex
CREATE INDEX "eob_entries_statusCategory_idx" ON "eob_entries"("statusCategory");

-- CreateIndex
CREATE INDEX "eob_entries_entryType_idx" ON "eob_entries"("entryType");

-- CreateIndex
CREATE INDEX "eob_entries_dateOfService_idx" ON "eob_entries"("dateOfService");

-- CreateIndex
CREATE INDEX "eob_work_notes_entryId_workedAt_idx" ON "eob_work_notes"("entryId", "workedAt");

-- CreateIndex
CREATE INDEX "eob_work_notes_workedById_workedAt_idx" ON "eob_work_notes"("workedById", "workedAt");

-- AddForeignKey
ALTER TABLE "eob_batches" ADD CONSTRAINT "eob_batches_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eob_batches" ADD CONSTRAINT "eob_batches_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eob_entries" ADD CONSTRAINT "eob_entries_eobBatchId_fkey" FOREIGN KEY ("eobBatchId") REFERENCES "eob_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eob_entries" ADD CONSTRAINT "eob_entries_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eob_entries" ADD CONSTRAINT "eob_entries_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eob_entries" ADD CONSTRAINT "eob_entries_arClaimId_fkey" FOREIGN KEY ("arClaimId") REFERENCES "ar_claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eob_work_notes" ADD CONSTRAINT "eob_work_notes_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "eob_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eob_work_notes" ADD CONSTRAINT "eob_work_notes_workedById_fkey" FOREIGN KEY ("workedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eob_work_notes" ADD CONSTRAINT "eob_work_notes_assignedToChangedId_fkey" FOREIGN KEY ("assignedToChangedId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
