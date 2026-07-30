-- AlterTable
ALTER TABLE "Practice" ADD COLUMN     "billingAddressLine1" TEXT,
ADD COLUMN     "billingAddressLine2" TEXT,
ADD COLUMN     "billingCity" TEXT,
ADD COLUMN     "billingState" TEXT,
ADD COLUMN     "billingZip" TEXT,
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactFax" TEXT,
ADD COLUMN     "contactPersonName" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "medicaidProviderNumber" TEXT,
ADD COLUMN     "medicarePtan" TEXT,
ADD COLUMN     "npi" TEXT,
ADD COLUMN     "taxId" TEXT,
ADD COLUMN     "taxonomy" TEXT;

-- CreateIndex
CREATE INDEX "Practice_isActive_idx" ON "Practice"("isActive");
