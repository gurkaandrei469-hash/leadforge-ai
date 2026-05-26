-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('FREE', 'STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('WEB_SEARCH', 'DIRECTORY', 'COMPANY_PAGE', 'BLOG', 'FORUM', 'SOCIAL_LINKEDIN', 'SOCIAL_TWITTER', 'CONTACT_PAGE', 'LISTING', 'DATABASE', 'CUSTOM_URL_LIST');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'VERIFIED', 'ENRICHED', 'EXPORTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VALID', 'INVALID', 'RISKY', 'UNKNOWN', 'CATCH_ALL');

-- CreateEnum
CREATE TYPE "ExportFormat" AS ENUM ('CSV', 'XLSX', 'JSON');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'UNPAID');

-- CreateEnum
CREATE TYPE "CreditTransactionType" AS ENUM ('PURCHASE', 'SUBSCRIPTION_GRANT', 'EXTRACTION', 'VERIFICATION', 'ENRICHMENT', 'REFUND', 'ADJUSTMENT', 'TRIAL_GRANT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "clerkId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT,
    "avatarUrl" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "ownerId" TEXT NOT NULL,
    "planTier" "PlanTier" NOT NULL DEFAULT 'FREE',
    "creditsTotal" INTEGER NOT NULL DEFAULT 100,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "creditsResetAt" TIMESTAMP(3),
    "billingEmail" TEXT,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "trialEndsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionJob" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "JobPriority" NOT NULL DEFAULT 'NORMAL',
    "sources" "SourceType"[],
    "filters" JSONB NOT NULL,
    "targetLeads" INTEGER NOT NULL DEFAULT 100,
    "leadsFound" INTEGER NOT NULL DEFAULT 0,
    "leadsVerified" INTEGER NOT NULL DEFAULT 0,
    "pagesScraped" INTEGER NOT NULL DEFAULT 0,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "bullJobId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "estimatedFinishAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtractionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobEvent" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "jobId" TEXT,
    "email" TEXT,
    "emailNormalized" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "fullName" TEXT,
    "jobTitle" TEXT,
    "jobRole" TEXT,
    "jobSeniority" TEXT,
    "jobDepartment" TEXT,
    "companyName" TEXT,
    "companyDomain" TEXT,
    "companyWebsite" TEXT,
    "companySize" TEXT,
    "companyIndustry" TEXT,
    "companyRevenue" TEXT,
    "country" TEXT,
    "countryCode" TEXT,
    "region" TEXT,
    "city" TEXT,
    "timezone" TEXT,
    "language" TEXT,
    "linkedinUrl" TEXT,
    "twitterUrl" TEXT,
    "facebookUrl" TEXT,
    "instagramUrl" TEXT,
    "githubUrl" TEXT,
    "sourceType" "SourceType" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourcePageTitle" TEXT,
    "matchedKeywords" TEXT[],
    "niche" TEXT,
    "niches" TEXT[],
    "qualityScore" INTEGER,
    "relevanceScore" INTEGER,
    "intentScore" INTEGER,
    "authorityScore" INTEGER,
    "aiTags" TEXT[],
    "aiSummary" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "emailScore" INTEGER,
    "technologies" TEXT[],
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "customFields" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadEnrichment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "rawData" JSONB NOT NULL,
    "enrichedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadEnrichment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerification" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "syntaxValid" BOOLEAN,
    "isDisposable" BOOLEAN,
    "mxValid" BOOLEAN,
    "mxRecords" TEXT[],
    "smtpDeliverable" BOOLEAN,
    "isCatchAll" BOOLEAN,
    "isRoleAccount" BOOLEAN,
    "status" "VerificationStatus" NOT NULL,
    "score" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "durationMs" INTEGER,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainCache" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "mxRecords" TEXT[],
    "hasMx" BOOLEAN NOT NULL,
    "isDisposable" BOOLEAN NOT NULL,
    "isCatchAll" BOOLEAN,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DomainCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Export" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "jobId" TEXT,
    "format" "ExportFormat" NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'PENDING',
    "filters" JSONB,
    "leadCount" INTEGER NOT NULL DEFAULT 0,
    "fileUrl" TEXT,
    "fileSizeBytes" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Export_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "stripePriceId" TEXT NOT NULL,
    "planTier" "PlanTier" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" TEXT NOT NULL,
    "invoiceUrl" TEXT,
    "pdfUrl" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "type" "CreditTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "description" TEXT,
    "jobId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "teamId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastTriggeredAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkId_key" ON "User"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_clerkId_idx" ON "User"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_slug_key" ON "Team"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Team_stripeCustomerId_key" ON "Team"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_stripeSubscriptionId_key" ON "Team"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "Team_slug_idx" ON "Team"("slug");

-- CreateIndex
CREATE INDEX "Team_stripeCustomerId_idx" ON "Team"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "TeamMembership_teamId_idx" ON "TeamMembership"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMembership_userId_teamId_key" ON "TeamMembership"("userId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");

-- CreateIndex
CREATE INDEX "Invitation_token_idx" ON "Invitation"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_email_teamId_key" ON "Invitation"("email", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_keyHash_idx" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_teamId_idx" ON "ApiKey"("teamId");

-- CreateIndex
CREATE INDEX "ExtractionJob_teamId_status_idx" ON "ExtractionJob"("teamId", "status");

-- CreateIndex
CREATE INDEX "ExtractionJob_status_priority_idx" ON "ExtractionJob"("status", "priority");

-- CreateIndex
CREATE INDEX "ExtractionJob_bullJobId_idx" ON "ExtractionJob"("bullJobId");

-- CreateIndex
CREATE INDEX "JobEvent_jobId_createdAt_idx" ON "JobEvent"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_teamId_status_idx" ON "Lead"("teamId", "status");

-- CreateIndex
CREATE INDEX "Lead_teamId_verificationStatus_idx" ON "Lead"("teamId", "verificationStatus");

-- CreateIndex
CREATE INDEX "Lead_jobId_idx" ON "Lead"("jobId");

-- CreateIndex
CREATE INDEX "Lead_companyDomain_idx" ON "Lead"("companyDomain");

-- CreateIndex
CREATE INDEX "Lead_qualityScore_idx" ON "Lead"("qualityScore");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_teamId_emailNormalized_key" ON "Lead"("teamId", "emailNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "LeadEnrichment_leadId_key" ON "LeadEnrichment"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerification_leadId_key" ON "EmailVerification"("leadId");

-- CreateIndex
CREATE INDEX "EmailVerification_emailNormalized_idx" ON "EmailVerification"("emailNormalized");

-- CreateIndex
CREATE INDEX "EmailVerification_status_idx" ON "EmailVerification"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DomainCache_domain_key" ON "DomainCache"("domain");

-- CreateIndex
CREATE INDEX "DomainCache_domain_idx" ON "DomainCache"("domain");

-- CreateIndex
CREATE INDEX "DomainCache_expiresAt_idx" ON "DomainCache"("expiresAt");

-- CreateIndex
CREATE INDEX "Export_teamId_status_idx" ON "Export"("teamId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "Subscription_teamId_idx" ON "Subscription"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_stripeInvoiceId_key" ON "Invoice"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "Invoice_teamId_idx" ON "Invoice"("teamId");

-- CreateIndex
CREATE INDEX "CreditTransaction_teamId_createdAt_idx" ON "CreditTransaction"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_teamId_createdAt_idx" ON "AuditLog"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_resourceId_idx" ON "AuditLog"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimit_key_key" ON "RateLimit"("key");

-- CreateIndex
CREATE INDEX "RateLimit_key_idx" ON "RateLimit"("key");

-- CreateIndex
CREATE INDEX "RateLimit_resetAt_idx" ON "RateLimit"("resetAt");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionJob" ADD CONSTRAINT "ExtractionJob_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobEvent" ADD CONSTRAINT "JobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ExtractionJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ExtractionJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEnrichment" ADD CONSTRAINT "LeadEnrichment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerification" ADD CONSTRAINT "EmailVerification_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Export" ADD CONSTRAINT "Export_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Export" ADD CONSTRAINT "Export_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ExtractionJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
