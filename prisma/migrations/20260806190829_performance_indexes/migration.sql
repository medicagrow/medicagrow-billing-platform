-- CreateIndex
CREATE INDEX "ar_claims_dateOfService_idx" ON "ar_claims"("dateOfService");

-- CreateIndex
CREATE INDEX "ar_claims_statusLabel_idx" ON "ar_claims"("statusLabel");

-- CreateIndex
CREATE INDEX "ar_claims_balance_idx" ON "ar_claims"("balance");

-- CreateIndex
CREATE INDEX "ar_work_notes_workedAt_idx" ON "ar_work_notes"("workedAt");

-- CreateIndex
CREATE INDEX "tasks_completedById_completedAt_idx" ON "tasks"("completedById", "completedAt");

-- CreateIndex
CREATE INDEX "tasks_isRecurring_idx" ON "tasks"("isRecurring");

-- CreateIndex
CREATE INDEX "todos_completedById_completedAt_idx" ON "todos"("completedById", "completedAt");
