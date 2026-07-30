-- CreateEnum
CREATE TYPE "LockStatus" AS ENUM ('DRAFT', 'LOCKED');

-- CreateTable
CREATE TABLE "tracker_entries" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "monthYear" TIMESTAMP(3) NOT NULL,
    "enteredById" TEXT NOT NULL,
    "lastUpdatedById" TEXT,
    "totalAppointments" INTEGER,
    "totalVisits" INTEGER,
    "totalClaims" INTEGER,
    "totalCharges" DECIMAL(14,2),
    "totalPayments" DECIMAL(14,2),
    "totalAdjustments" DECIMAL(14,2),
    "netCollectionRate" DECIMAL(6,4),
    "paymentEfficiency" DECIMAL(6,4),
    "pendingClaimsToBill" INTEGER,
    "pendingEraToPost" INTEGER,
    "pendingPatientPaymentsToPost" INTEGER,
    "rejectionsReceived" INTEGER,
    "outstandingRejections" INTEGER,
    "eobDenialsReceived" INTEGER,
    "outstandingEobDenials" INTEGER,
    "denialRate" DECIMAL(6,4),
    "arCount0to30" INTEGER,
    "arAmount0to30" DECIMAL(14,2),
    "arCount31to60" INTEGER,
    "arAmount31to60" DECIMAL(14,2),
    "arCount61to90" INTEGER,
    "arAmount61to90" DECIMAL(14,2),
    "arCount90plus" INTEGER,
    "arAmount90plus" DECIMAL(14,2),
    "totalAr" DECIMAL(14,2),
    "arPercentOver90" DECIMAL(6,4),
    "followUpCompliance" DECIMAL(6,4),
    "totalAppointmentsForElig" INTEGER,
    "eligibilityCompleted" INTEGER,
    "eligibilityCompliance" DECIMAL(6,4),
    "eftEnrollment" DECIMAL(6,4),
    "eraEnrollment" DECIMAL(6,4),
    "portalAccess" DECIMAL(6,4),
    "feeSchedule" DECIMAL(6,4),
    "sopCompliance" DECIMAL(6,4),
    "resourcesAssigned" DECIMAL(6,2),
    "monthlyReviewMeeting" BOOLEAN,
    "directClientCommunication" TEXT,
    "scoreA" INTEGER,
    "scoreB" INTEGER,
    "scoreC" INTEGER,
    "scoreD" INTEGER,
    "scoreE" INTEGER,
    "scoreF" INTEGER,
    "scoreG" INTEGER,
    "scoreH" INTEGER,
    "finalScore" DECIMAL(6,2),
    "lockStatus" "LockStatus" NOT NULL DEFAULT 'DRAFT',
    "lockedAt" TIMESTAMP(3),
    "lockedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracker_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tracker_entries_monthYear_idx" ON "tracker_entries"("monthYear");

-- CreateIndex
CREATE INDEX "tracker_entries_lockStatus_idx" ON "tracker_entries"("lockStatus");

-- CreateIndex
CREATE UNIQUE INDEX "tracker_entries_practiceId_monthYear_key" ON "tracker_entries"("practiceId", "monthYear");

-- AddForeignKey
ALTER TABLE "tracker_entries" ADD CONSTRAINT "tracker_entries_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracker_entries" ADD CONSTRAINT "tracker_entries_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracker_entries" ADD CONSTRAINT "tracker_entries_lastUpdatedById_fkey" FOREIGN KEY ("lastUpdatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracker_entries" ADD CONSTRAINT "tracker_entries_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
