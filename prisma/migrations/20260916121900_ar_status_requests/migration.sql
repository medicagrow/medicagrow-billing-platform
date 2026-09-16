-- CreateEnum
CREATE TYPE "ArStatusRequestStatus" AS ENUM ('PENDING', 'PARTIALLY_APPROVED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ArStatusRequestItemStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "ar_claims" ADD COLUMN     "pendingStatusRequestId" TEXT;

-- CreateTable
CREATE TABLE "ar_status_requests" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedStatus" TEXT NOT NULL,
    "requestedCategory" "StatusCategory" NOT NULL,
    "note" TEXT NOT NULL,
    "status" "ArStatusRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ar_status_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ar_status_request_items" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "itemStatus" "ArStatusRequestItemStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "rejectionNote" TEXT,

    CONSTRAINT "ar_status_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ar_status_requests_batchId_status_idx" ON "ar_status_requests"("batchId", "status");

-- CreateIndex
CREATE INDEX "ar_status_requests_requestedById_idx" ON "ar_status_requests"("requestedById");

-- CreateIndex
CREATE INDEX "ar_status_request_items_claimId_idx" ON "ar_status_request_items"("claimId");

-- CreateIndex
CREATE UNIQUE INDEX "ar_status_request_items_requestId_claimId_key" ON "ar_status_request_items"("requestId", "claimId");

-- AddForeignKey
ALTER TABLE "ar_claims" ADD CONSTRAINT "ar_claims_pendingStatusRequestId_fkey" FOREIGN KEY ("pendingStatusRequestId") REFERENCES "ar_status_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_status_requests" ADD CONSTRAINT "ar_status_requests_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ar_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_status_requests" ADD CONSTRAINT "ar_status_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_status_requests" ADD CONSTRAINT "ar_status_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_status_request_items" ADD CONSTRAINT "ar_status_request_items_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ar_status_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_status_request_items" ADD CONSTRAINT "ar_status_request_items_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ar_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
