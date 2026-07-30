-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'PROJECT_MANAGER', 'BILLER');

-- CreateEnum
CREATE TYPE "EhrSource" AS ENUM ('OPEN_PM', 'SIMPLE_PRACTICE', 'THERAPYNOTE', 'ECW', 'OFFICE_ALLY');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "hashedPassword" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'BILLER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Practice" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ehrSource" "EhrSource" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Practice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPractice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,

    CONSTRAINT "UserPractice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "Practice_ehrSource_idx" ON "Practice"("ehrSource");

-- CreateIndex
CREATE INDEX "UserPractice_practiceId_idx" ON "UserPractice"("practiceId");

-- CreateIndex
CREATE INDEX "UserPractice_assignedById_idx" ON "UserPractice"("assignedById");

-- CreateIndex
CREATE UNIQUE INDEX "UserPractice_userId_practiceId_key" ON "UserPractice"("userId", "practiceId");

-- AddForeignKey
ALTER TABLE "UserPractice" ADD CONSTRAINT "UserPractice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPractice" ADD CONSTRAINT "UserPractice_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPractice" ADD CONSTRAINT "UserPractice_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
