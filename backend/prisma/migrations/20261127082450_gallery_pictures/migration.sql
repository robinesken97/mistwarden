-- CreateTable
CREATE TABLE "GalleryPicture" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "folder" TEXT NOT NULL DEFAULT '',
    "shownToAll" BOOLEAN NOT NULL DEFAULT false,
    "shownTo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GalleryPicture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GalleryPicture_campaignId_idx" ON "GalleryPicture"("campaignId");

-- CreateIndex
CREATE INDEX "GalleryPicture_assetId_idx" ON "GalleryPicture"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "GalleryPicture_campaignId_assetId_key" ON "GalleryPicture"("campaignId", "assetId");

-- AddForeignKey
ALTER TABLE "GalleryPicture" ADD CONSTRAINT "GalleryPicture_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryPicture" ADD CONSTRAINT "GalleryPicture_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
