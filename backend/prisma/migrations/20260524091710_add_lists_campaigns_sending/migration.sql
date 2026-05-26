-- CreateEnum
CREATE TYPE "SendingProvider" AS ENUM ('SMTP', 'SENDGRID', 'SES', 'GMAIL_OAUTH');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'SENT', 'REPLIED', 'BOUNCED', 'UNSUBSCRIBED', 'FAILED');

-- CreateEnum
CREATE TYPE "SendStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'REPLIED', 'BOUNCED', 'FAILED');

-- CreateTable
CREATE TABLE "LeadList" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT 'violet',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadListMembership" (
    "listId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadListMembership_pkey" PRIMARY KEY ("listId","leadId")
);

-- CreateTable
CREATE TABLE "SendingAccount" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "provider" "SendingProvider" NOT NULL,
    "name" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpUser" TEXT,
    "smtpPassEnc" TEXT,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT true,
    "apiKeyEnc" TEXT,
    "dailyLimit" INTEGER NOT NULL DEFAULT 50,
    "sentToday" INTEGER NOT NULL DEFAULT 0,
    "lastSendAt" TIMESTAMP(3),
    "lastResetAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SendingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "sendingAccountId" TEXT,
    "dailyLimit" INTEGER NOT NULL DEFAULT 50,
    "sendStartHour" INTEGER NOT NULL DEFAULT 9,
    "sendEndHour" INTEGER NOT NULL DEFAULT 17,
    "weekdaysOnly" BOOLEAN NOT NULL DEFAULT true,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "openedCount" INTEGER NOT NULL DEFAULT 0,
    "clickedCount" INTEGER NOT NULL DEFAULT 0,
    "repliedCount" INTEGER NOT NULL DEFAULT 0,
    "bouncedCount" INTEGER NOT NULL DEFAULT 0,
    "unsubCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "launchedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignStep" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "status" "RecipientStatus" NOT NULL DEFAULT 'QUEUED',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "nextSendAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSend" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "status" "SendStatus" NOT NULL DEFAULT 'PENDING',
    "toEmail" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyRendered" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailEvent" (
    "id" TEXT NOT NULL,
    "sendId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnsubscribeToken" (
    "token" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "campaignId" TEXT,
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnsubscribeToken_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE INDEX "LeadList_teamId_idx" ON "LeadList"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadList_teamId_name_key" ON "LeadList"("teamId", "name");

-- CreateIndex
CREATE INDEX "LeadListMembership_leadId_idx" ON "LeadListMembership"("leadId");

-- CreateIndex
CREATE INDEX "SendingAccount_teamId_idx" ON "SendingAccount"("teamId");

-- CreateIndex
CREATE INDEX "Campaign_teamId_status_idx" ON "Campaign"("teamId", "status");

-- CreateIndex
CREATE INDEX "CampaignStep_campaignId_idx" ON "CampaignStep"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignStep_campaignId_order_key" ON "CampaignStep"("campaignId", "order");

-- CreateIndex
CREATE INDEX "CampaignRecipient_status_nextSendAt_idx" ON "CampaignRecipient"("status", "nextSendAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_leadId_key" ON "CampaignRecipient"("campaignId", "leadId");

-- CreateIndex
CREATE INDEX "EmailSend_campaignId_status_idx" ON "EmailSend"("campaignId", "status");

-- CreateIndex
CREATE INDEX "EmailSend_recipientId_idx" ON "EmailSend"("recipientId");

-- CreateIndex
CREATE INDEX "EmailSend_providerMessageId_idx" ON "EmailSend"("providerMessageId");

-- CreateIndex
CREATE INDEX "EmailEvent_sendId_idx" ON "EmailEvent"("sendId");

-- CreateIndex
CREATE INDEX "UnsubscribeToken_leadId_idx" ON "UnsubscribeToken"("leadId");

-- AddForeignKey
ALTER TABLE "LeadList" ADD CONSTRAINT "LeadList_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadListMembership" ADD CONSTRAINT "LeadListMembership_listId_fkey" FOREIGN KEY ("listId") REFERENCES "LeadList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadListMembership" ADD CONSTRAINT "LeadListMembership_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendingAccount" ADD CONSTRAINT "SendingAccount_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_sendingAccountId_fkey" FOREIGN KEY ("sendingAccountId") REFERENCES "SendingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignStep" ADD CONSTRAINT "CampaignStep_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSend" ADD CONSTRAINT "EmailSend_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSend" ADD CONSTRAINT "EmailSend_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "CampaignRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSend" ADD CONSTRAINT "EmailSend_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "CampaignStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_sendId_fkey" FOREIGN KEY ("sendId") REFERENCES "EmailSend"("id") ON DELETE CASCADE ON UPDATE CASCADE;
