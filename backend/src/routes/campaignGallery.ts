// Added for Mistwarden on 2026-11-27.
// ============================================
// A campaign's gallery: pictures the GM files in named folders and shows to
// every player or to chosen ones; a picture opens for a player when it is
// shown to them.
//
// A gallery picture is a MAP asset of the campaign. The map-picture rule
// (services/permissions.ts) keeps it from players until a row here shows it
// to them, so the file and its thumbnail open exactly for the players the
// list below names. Mounted under /api/campaigns.
// ============================================

import { Router, Response } from 'express';
import type { GalleryPicture } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/rbac';
import { campaignMember, campaignGM } from '../middleware/compose';
import { prisma } from '../config/database';
import { AddGalleryPictureSchema, UpdateGalleryPictureSchema } from '../validators/gallery';
import { broadcastToCampaign, broadcastToUser } from '../websocket/utils';
import logger from '../utils/logger';

const router = Router();

/** A picture as the GM sees it. */
function forGm(p: GalleryPicture) {
  return {
    id: p.id,
    assetId: p.assetId,
    name: p.name,
    folder: p.folder,
    shownToAll: p.shownToAll,
    shownTo: p.shownTo,
    url: `/api/assets/maps/${p.assetId}`,
    thumbnailUrl: `/api/assets/maps/${p.assetId}/thumbnail`,
    updatedAt: p.updatedAt,
  };
}

/** A picture as a player it is shown to sees it: no folder, no other players. */
function forPlayer(p: GalleryPicture) {
  return {
    id: p.id,
    assetId: p.assetId,
    name: p.name,
    url: `/api/assets/maps/${p.assetId}`,
    thumbnailUrl: `/api/assets/maps/${p.assetId}/thumbnail`,
    updatedAt: p.updatedAt,
  };
}

/**
 * Tell the campaign's pages that the gallery changed, and each player who can
 * now see `picture` and could not before that it was shown to them, so their
 * page opens it. Never throws: the change is already saved.
 */
async function announce(campaignId: string, before: GalleryPicture | null, after: GalleryPicture | null): Promise<void> {
  try {
    broadcastToCampaign(campaignId, 'gallery.changed', { campaignId });
    if (!after || !(after.shownToAll || after.shownTo.length > 0)) return;
    const players = await prisma.campaignMembership.findMany({
      where: { campaignId, role: { not: 'GM' } },
      select: { userId: true },
    });
    const sees = (p: GalleryPicture | null, userId: string) => !!p && (p.shownToAll || p.shownTo.includes(userId));
    for (const { userId } of players) {
      if (sees(after, userId) && !sees(before, userId)) {
        broadcastToUser(userId, 'gallery.shown', { campaignId, picture: forPlayer(after) });
      }
    }
  } catch (error) {
    logger.warn('Gallery change not announced; the change stands', { err: error, campaignId });
  }
}

const invalid = (res: Response, message: string | undefined) =>
  res.status(400).json({ error: 'Validation Error', message: message ?? 'Invalid request' });

/**
 * GET /api/campaigns/:campaignId/gallery
 * The GM gets every picture; a player only those shown to them.
 * Requires: Campaign membership (any role)
 */
router.get('/:campaignId/gallery', campaignMember, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { campaignId } = req.params;
    const userId = req.session.userId!;
    if (req.campaignMembership?.role === 'GM') {
      const pictures = await prisma.galleryPicture.findMany({ where: { campaignId }, orderBy: [{ folder: 'asc' }, { name: 'asc' }] });
      return res.json({ pictures: pictures.map(forGm) });
    }
    const pictures = await prisma.galleryPicture.findMany({
      where: { campaignId, OR: [{ shownToAll: true }, { shownTo: { has: userId } }] },
      orderBy: { updatedAt: 'desc' },
    });
    return res.json({ pictures: pictures.map(forPlayer) });
  } catch (error) {
    logger.error('Error listing the gallery', { err: error });
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to load the gallery' });
  }
});

/**
 * POST /api/campaigns/:campaignId/gallery
 * File a map picture of this campaign in its gallery, shown to nobody yet.
 * Requires: Campaign GM role
 */
router.post('/:campaignId/gallery', campaignGM, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = AddGalleryPictureSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error.issues[0]?.message);
    const { campaignId } = req.params;
    const { assetId, name, folder } = parsed.data;

    const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { type: true, scope: true, campaignId: true } });
    if (!asset || asset.type !== 'MAP' || asset.scope !== 'CAMPAIGN' || asset.campaignId !== campaignId) {
      return res.status(404).json({ error: 'Not Found', message: "Picture not found among this campaign's pictures" });
    }
    const existing = await prisma.galleryPicture.findUnique({ where: { campaignId_assetId: { campaignId, assetId } } });
    if (existing) {
      return res.status(409).json({ error: 'Conflict', message: 'This picture is already in the gallery' });
    }
    const picture = await prisma.galleryPicture.create({ data: { campaignId, assetId, name, folder: folder ?? '' } });
    await announce(campaignId, null, picture);
    return res.status(201).json({ picture: forGm(picture) });
  } catch (error) {
    logger.error('Error adding a picture to the gallery', { err: error });
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to add the picture' });
  }
});

/**
 * PATCH /api/campaigns/:campaignId/gallery/:pictureId
 * Rename a picture, move it to another folder, or change who sees it.
 * `shownTo` names players of this campaign; anyone else is refused.
 * Requires: Campaign GM role
 */
router.patch('/:campaignId/gallery/:pictureId', campaignGM, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = UpdateGalleryPictureSchema.safeParse(req.body);
    if (!parsed.success) return invalid(res, parsed.error.issues[0]?.message);
    const { campaignId, pictureId } = req.params;
    const before = await prisma.galleryPicture.findFirst({ where: { id: pictureId, campaignId } });
    if (!before) return res.status(404).json({ error: 'Not Found', message: 'Picture not found in this gallery' });

    const data = { ...parsed.data };
    if (data.shownTo) {
      data.shownTo = [...new Set(data.shownTo)];
      const players = await prisma.campaignMembership.count({
        where: { campaignId, userId: { in: data.shownTo }, role: { not: 'GM' } },
      });
      if (players !== data.shownTo.length) return invalid(res, 'A picture can only be shown to players of this campaign');
    }
    const after = await prisma.galleryPicture.update({ where: { id: before.id }, data });
    await announce(campaignId, before, after);
    return res.json({ picture: forGm(after) });
  } catch (error) {
    logger.error('Error changing a gallery picture', { err: error });
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to change the picture' });
  }
});

/**
 * DELETE /api/campaigns/:campaignId/gallery/:pictureId
 * Take a picture out of the gallery. The picture itself stays in the
 * campaign's assets, hidden from players again.
 * Requires: Campaign GM role
 */
router.delete('/:campaignId/gallery/:pictureId', campaignGM, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { campaignId, pictureId } = req.params;
    const { count } = await prisma.galleryPicture.deleteMany({ where: { id: pictureId, campaignId } });
    if (count === 0) return res.status(404).json({ error: 'Not Found', message: 'Picture not found in this gallery' });
    await announce(campaignId, null, null);
    return res.json({ message: 'Picture removed from the gallery' });
  } catch (error) {
    logger.error('Error removing a gallery picture', { err: error });
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to remove the picture' });
  }
});

export default router;
