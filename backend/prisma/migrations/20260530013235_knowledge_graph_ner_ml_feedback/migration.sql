-- CreateEnum
CREATE TYPE "FundingRoundType" AS ENUM ('PRE_SEED', 'SEED', 'SERIES_A', 'SERIES_B', 'SERIES_C', 'SERIES_D', 'SERIES_E_PLUS', 'GROWTH', 'DEBT', 'IPO', 'ACQUISITION', 'SECONDARY');

-- CreateEnum
CREATE TYPE "FeedbackKind" AS ENUM ('HELPFUL', 'NOT_HELPFUL', 'WRONG_INDUSTRY', 'WRONG_ROLE', 'TOO_SMALL', 'TOO_BIG', 'ALREADY_CUSTOMER', 'BAD_FIT', 'REPLIED_POSITIVELY', 'REPLIED_NEGATIVELY', 'IGNORED');

-- CreateEnum
CREATE TYPE "CrawlState" AS ENUM ('PENDING', 'IN_FLIGHT', 'SUCCEEDED', 'FAILED', 'ROBOTS_DENIED', 'SKIPPED');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "companyId" TEXT;

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "industryId" TEXT,
    "employeeCount" INTEGER,
    "employeeRange" TEXT,
    "foundedYear" INTEGER,
    "hqCity" TEXT,
    "hqCountry" TEXT,
    "hqRegion" TEXT,
    "linkedinUrl" TEXT,
    "twitterUrl" TEXT,
    "githubUrl" TEXT,
    "crunchbaseUrl" TEXT,
    "totalFundingUsd" BIGINT,
    "lastFundingRound" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "ticker" TEXT,
    "hasSpf" BOOLEAN NOT NULL DEFAULT false,
    "hasDmarc" BOOLEAN NOT NULL DEFAULT false,
    "enrichedAt" TIMESTAMP(3),
    "enrichmentSources" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Industry" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Industry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Technology" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "vendor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Technology_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyTechnology" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "technologyId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyTechnology_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "round" "FundingRoundType" NOT NULL,
    "amountUsd" BIGINT,
    "valuationUsd" BIGINT,
    "announcedOn" TIMESTAMP(3) NOT NULL,
    "investors" TEXT[],
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutiveMove" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "personName" TEXT NOT NULL,
    "newTitle" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "announcedOn" TIMESTAMP(3) NOT NULL,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutiveMove_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadScoreFeedback" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT,
    "scoreAtFeedback" INTEGER,
    "tierAtFeedback" TEXT,
    "kind" "FeedbackKind" NOT NULL,
    "notes" TEXT,
    "features" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadScoreFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlEntry" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "jobId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "state" "CrawlState" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "notBefore" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetchedAt" TIMESTAMP(3),
    "httpStatus" INTEGER,
    "errorMessage" TEXT,
    "contentHash" TEXT,
    "contentBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrawlEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlHost" (
    "host" TEXT NOT NULL,
    "delaySeconds" INTEGER NOT NULL DEFAULT 2,
    "concurrencyMax" INTEGER NOT NULL DEFAULT 1,
    "lastFetchedAt" TIMESTAMP(3),
    "robotsTxt" TEXT,
    "robotsFetchedAt" TIMESTAMP(3),
    "lastRateRemain" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrawlHost_pkey" PRIMARY KEY ("host")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_domain_key" ON "Company"("domain");

-- CreateIndex
CREATE INDEX "Company_name_idx" ON "Company"("name");

-- CreateIndex
CREATE INDEX "Company_industryId_idx" ON "Company"("industryId");

-- CreateIndex
CREATE INDEX "Company_hqCountry_idx" ON "Company"("hqCountry");

-- CreateIndex
CREATE INDEX "Company_employeeCount_idx" ON "Company"("employeeCount");

-- CreateIndex
CREATE UNIQUE INDEX "Industry_slug_key" ON "Industry"("slug");

-- CreateIndex
CREATE INDEX "Industry_parentId_idx" ON "Industry"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Technology_slug_key" ON "Technology"("slug");

-- CreateIndex
CREATE INDEX "Technology_category_idx" ON "Technology"("category");

-- CreateIndex
CREATE INDEX "CompanyTechnology_technologyId_idx" ON "CompanyTechnology"("technologyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyTechnology_companyId_technologyId_key" ON "CompanyTechnology"("companyId", "technologyId");

-- CreateIndex
CREATE INDEX "FundingEvent_companyId_announcedOn_idx" ON "FundingEvent"("companyId", "announcedOn");

-- CreateIndex
CREATE INDEX "FundingEvent_announcedOn_idx" ON "FundingEvent"("announcedOn");

-- CreateIndex
CREATE INDEX "ExecutiveMove_companyId_announcedOn_idx" ON "ExecutiveMove"("companyId", "announcedOn");

-- CreateIndex
CREATE INDEX "LeadScoreFeedback_teamId_leadId_idx" ON "LeadScoreFeedback"("teamId", "leadId");

-- CreateIndex
CREATE INDEX "LeadScoreFeedback_kind_idx" ON "LeadScoreFeedback"("kind");

-- CreateIndex
CREATE INDEX "LeadScoreFeedback_createdAt_idx" ON "LeadScoreFeedback"("createdAt");

-- CreateIndex
CREATE INDEX "CrawlEntry_host_notBefore_idx" ON "CrawlEntry"("host", "notBefore");

-- CreateIndex
CREATE INDEX "CrawlEntry_state_priority_idx" ON "CrawlEntry"("state", "priority");

-- CreateIndex
CREATE INDEX "CrawlEntry_jobId_state_idx" ON "CrawlEntry"("jobId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "CrawlEntry_url_jobId_key" ON "CrawlEntry"("url", "jobId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Industry" ADD CONSTRAINT "Industry_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Industry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTechnology" ADD CONSTRAINT "CompanyTechnology_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTechnology" ADD CONSTRAINT "CompanyTechnology_technologyId_fkey" FOREIGN KEY ("technologyId") REFERENCES "Technology"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingEvent" ADD CONSTRAINT "FundingEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutiveMove" ADD CONSTRAINT "ExecutiveMove_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadScoreFeedback" ADD CONSTRAINT "LeadScoreFeedback_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
