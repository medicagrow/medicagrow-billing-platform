-- CreateIndex
CREATE INDEX "ar_claims_batchId_agingDays_idx" ON "ar_claims"("batchId", "agingDays");

-- CreateIndex
CREATE INDEX "ar_claims_batchId_statusCategory_idx" ON "ar_claims"("batchId", "statusCategory");
