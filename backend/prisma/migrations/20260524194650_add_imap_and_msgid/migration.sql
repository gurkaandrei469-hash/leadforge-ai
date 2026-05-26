-- AlterTable
ALTER TABLE "EmailSend" ADD COLUMN     "messageIdHeader" TEXT;

-- AlterTable
ALTER TABLE "SendingAccount" ADD COLUMN     "imapEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "imapHost" TEXT,
ADD COLUMN     "imapPassEnc" TEXT,
ADD COLUMN     "imapPort" INTEGER,
ADD COLUMN     "imapSecure" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "imapUser" TEXT,
ADD COLUMN     "lastImapPollAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "EmailSend_messageIdHeader_idx" ON "EmailSend"("messageIdHeader");
