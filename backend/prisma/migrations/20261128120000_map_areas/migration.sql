-- CreateTable
CREATE TABLE "MapArea" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "authorId" TEXT,
    "audience" "DrawingAudience" NOT NULL DEFAULT 'ALL',
    "shape" TEXT NOT NULL,
    "anchorX" DOUBLE PRECISION NOT NULL,
    "anchorY" DOUBLE PRECISION NOT NULL,
    "angle" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sizeFt" INTEGER NOT NULL,
    "widthFt" INTEGER,
    "exact" BOOLEAN NOT NULL DEFAULT false,
    "element" TEXT NOT NULL DEFAULT 'none',
    "animated" BOOLEAN NOT NULL DEFAULT true,
    "label" TEXT,
    "spellId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MapArea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MapArea_mapId_idx" ON "MapArea"("mapId");

-- AddForeignKey
ALTER TABLE "MapArea" ADD CONSTRAINT "MapArea_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapArea" ADD CONSTRAINT "MapArea_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
