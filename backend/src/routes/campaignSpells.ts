/**
 * A campaign's Spell Library: what its members may read (the SRD's spells,
 * the instance's own and the campaign's own, never another campaign's), and
 * its GM's own spells. A spell imported from Markdown is read without its
 * description by anyone but the GM and an administrator. Mounted at
 * /api/campaigns/:campaignId/spells; the instance's spells and the imports
 * are routes/spells.ts. No limiter of its own, for the reason given there.
 */

import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/rbac';
import { campaignGM, campaignMember } from '../middleware/compose';
import { prisma } from '../config/database';
import {
  createSpell, updateSpell, deleteSpell, visibleFrom, SPELL_LIST_SELECT, SPELL_NOT_FOUND,
} from '../services/spellLibrary';
import { sendSpellOutcome } from './spells';
import { IMPORT_SOURCE_PREFIX } from '../services/creatureImport';
import logger from '../utils/logger';

const router = Router({ mergeParams: true });

// Every spell the campaign may use, without descriptions, by name: the
// library's search, the AoE tool's and a sheet's "Place area" work from it.
router.get('/', campaignMember, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const spells = await prisma.spellTemplate.findMany({
      where: visibleFrom(req.params.campaignId),
      select: SPELL_LIST_SELECT,
      // Same names together in the order a name picks them by (resolveSpellByName): source, then id.
      orderBy: [{ name: 'asc' }, { source: 'asc' }, { id: 'asc' }],
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
    // An imported book's text is the GM's to read, not the table's (services/spellImport.ts).
    const readsText = req.campaignMembership?.role === 'GM' || req.session.platformRole === 'ADMIN';
    if (!readsText && spell.source.startsWith(IMPORT_SOURCE_PREFIX)) return res.json({ ...spell, description: null });
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
