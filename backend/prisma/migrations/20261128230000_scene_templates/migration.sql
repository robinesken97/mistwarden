-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "useCreatureSize" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Map" ADD COLUMN     "isTemplate" BOOLEAN NOT NULL DEFAULT false;
