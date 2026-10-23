-- CreateEnum
CREATE TYPE "ArAssignmentSource" AS ENUM ('SINGLE', 'BULK');

-- CreateTable
CREATE TABLE "ar_claim_assignments" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "assignedById" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "ArAssignmentSource" NOT NULL,

    CONSTRAINT "ar_claim_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ar_claim_assignments_claimId_assignedAt_idx" ON "ar_claim_assignments"("claimId", "assignedAt");

-- CreateIndex
CREATE INDEX "ar_claim_assignments_assignedById_assignedAt_idx" ON "ar_claim_assignments"("assignedById", "assignedAt");

-- CreateIndex
CREATE INDEX "ar_claim_assignments_toUserId_assignedAt_idx" ON "ar_claim_assignments"("toUserId", "assignedAt");

-- AddForeignKey
ALTER TABLE "ar_claim_assignments" ADD CONSTRAINT "ar_claim_assignments_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ar_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_claim_assignments" ADD CONSTRAINT "ar_claim_assignments_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_claim_assignments" ADD CONSTRAINT "ar_claim_assignments_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_claim_assignments" ADD CONSTRAINT "ar_claim_assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
