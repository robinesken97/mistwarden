/**
 * A campaign's Spell Library: what its members may read (the SRD's spells,
 * the instance's own and the campaign's own, never another campaign's), and
 * its GM's own spells. Mounted at /api/campaigns/:campaignId/spells; the
 * instance's spells and the SRD import are routes/spells.ts. No limiter of
 * its own, for the reason given there.
 */

import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/rbac';
import { campaignGM, campaignMember } from '../middleware/compose';
import { prisma } from '../config/database';
import {
  createSpell, updateSpell, deleteSpell, visibleFrom, SPELL_LIST_SELECT, SPELL_NOT_FOUND,
} from '../services/spellLibrary';
import { sendSpellOutcome } from './spells';
import logger from '../utils/logger';

const router = Router({ mergeParams: true });

// Every spell the campaign may use, without descriptions, by name: the
// library's search, the AoE tool's and a sheet's "Place area" work from it.
router.get('/', campaignMember, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const spells = await prisma.spellTemplate.findMany({
      where: visibleFrom(req.params.campaignId),
      select: SPELL_LIST_SELECT,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return res.json({ spells });
  } catch (error) {
    logger.error('Error listing spells:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to list spells' });
  }
});

router.get('/:spellId', campaignMember, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const spell = await prisma.spellTemplate.findFirst({
      where: { id: req.params.spellId, ...visibleFrom(req.params.campaignId) },
    });
    if (!spell) return res.status(404).json({ error: 'Not Found', message: SPELL_NOT_FOUND });
    return res.json(spell);
  } catch (error) {
    logger.error('Error reading a spell:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to read the spell' });
  }
});

router.post('/', campaignGM, (req: AuthenticatedRequest, res: Response) =>
  sendSpellOutcome(res, () => createSpell(req.params.campaignId, req.session.userId!, req.body)));

router.put('/:spellId', campaignGM, (req: AuthenticatedRequest, res: Response) =>
  sendSpellOutcome(res, () => updateSpell(req.params.campaignId, req.params.spellId, req.body)));

router.delete('/:spellId', campaignGM, (req: AuthenticatedRequest, res: Response) =>
  sendSpellOutcome(res, () => deleteSpell(req.params.campaignId, req.params.spellId)));

export default router;
