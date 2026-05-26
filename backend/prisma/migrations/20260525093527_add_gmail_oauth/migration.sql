-- AlterTable
ALTER TABLE "SendingAccount" ADD COLUMN     "oauthAccessToken" TEXT,
ADD COLUMN     "oauthExpiresAt" TIMESTAMP(3),
ADD COLUMN     "oauthRefreshTokenEnc" TEXT,
ADD COLUMN     "oauthScopes" TEXT;
