-- CreateTable
CREATE TABLE "practice_providers" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "npi" TEXT NOT NULL,
    "licenseNumber" TEXT,
    "licenseState" TEXT,
    "taxonomy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_providers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "practice_providers_practiceId_isActive_idx" ON "practice_providers"("practiceId", "isActive");

-- CreateIndex
CREATE INDEX "practice_providers_npi_idx" ON "practice_providers"("npi");

-- AddForeignKey
ALTER TABLE "practice_providers" ADD CONSTRAINT "practice_providers_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
