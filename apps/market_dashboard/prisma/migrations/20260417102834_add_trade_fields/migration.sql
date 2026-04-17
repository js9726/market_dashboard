-- AlterTable
ALTER TABLE "SpreadsheetConnection" ADD COLUMN     "colMap" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "exitPrice" DECIMAL(12,4),
ADD COLUMN     "fees" DECIMAL(12,2),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "side" TEXT;
