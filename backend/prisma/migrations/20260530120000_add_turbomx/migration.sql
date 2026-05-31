-- AlterEnum
ALTER TYPE "SendingProvider" ADD VALUE 'TURBOMX';

-- AlterTable: TurboMX fields on SendingAccount
ALTER TABLE "SendingAccount"
  ADD COLUMN "heloHostname"      TEXT,
  ADD COLUMN "dkimDomain"        TEXT,
  ADD COLUMN "dkimKeySelector"   TEXT,
  ADD COLUMN "dkimPrivateKeyEnc" TEXT;
