-- CreateTable
CREATE TABLE "SpellTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'custom',
    "gameSystem" "GameSystem",
    "campaignId" TEXT,
    "createdById" TEXT,
    "level" INTEGER NOT NULL DEFAULT 0,
    "school" TEXT,
    "castingTime" TEXT,
    "range" TEXT,
    "components" TEXT,
    "duration" TEXT,
    "concentration" BOOLEAN NOT NULL DEFAULT false,
    "ritual" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL DEFAULT '',
    "area" JSONB,
    "element" TEXT NOT NULL DEFAULT 'none',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpellTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpellTemplate_campaignId_idx" ON "SpellTemplate"("campaignId");

-- CreateIndex
CREATE INDEX "SpellTemplate_source_idx" ON "SpellTemplate"("source");

-- CreateIndex
CREATE INDEX "SpellTemplate_name_idx" ON "SpellTemplate"("name");

-- CreateIndex
CREATE INDEX "SpellTemplate_createdById_idx" ON "SpellTemplate"("createdById");

-- AddForeignKey
ALTER TABLE "SpellTemplate" ADD CONSTRAINT "SpellTemplate_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpellTemplate" ADD CONSTRAINT "SpellTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

