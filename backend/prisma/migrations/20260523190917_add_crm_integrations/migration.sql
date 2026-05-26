-- CreateEnum
CREATE TYPE "CrmProvider" AS ENUM ('HUBSPOT', 'SALESFORCE', 'PIPEDRIVE');

-- CreateTable
CREATE TABLE "CrmConnection" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "provider" "CrmProvider" NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "accountLabel" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "totalPushed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmPush" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "externalId" TEXT,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmPush_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmConnection_teamId_provider_key" ON "CrmConnection"("teamId", "provider");

-- CreateIndex
CREATE INDEX "CrmPush_connectionId_idx" ON "CrmPush"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmPush_connectionId_leadId_key" ON "CrmPush"("connectionId", "leadId");

-- AddForeignKey
ALTER TABLE "CrmConnection" ADD CONSTRAINT "CrmConnection_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmPush" ADD CONSTRAINT "CrmPush_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CrmConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmPush" ADD CONSTRAINT "CrmPush_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
