-- AlterTable
ALTER TABLE "Practice" ADD COLUMN     "primaryPmId" TEXT;

-- CreateIndex
CREATE INDEX "Practice_primaryPmId_idx" ON "Practice"("primaryPmId");

-- AddForeignKey
ALTER TABLE "Practice" ADD CONSTRAINT "Practice_primaryPmId_fkey" FOREIGN KEY ("primaryPmId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
