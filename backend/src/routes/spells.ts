/**
 * The instance's Spell Library: the SRD import and the instance's own
 * spells, which every campaign lists (campaignSpells.ts). Platform admins
 * only, as the creature import is: any user can be the GM of a campaign of
 * their own. Mounted at /api/spells.
 *
 * No limiter of its own, as the creature library has none: every write is an
 * administrator's, the import runs one at a time (409 while it does), and
 * the general /api limit (app.ts) covers the rest.
 */

import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/rbac';
import { adminOnly, authenticated } from '../middleware/compose';
import { prisma } from '../config/database';
import { seedSrdSpells, getSpellSeedStatus } from '../services/spellSeed';
import { SeedSourceError } from '../services/creatureSeed';
import { createSpell, updateSpell, deleteSpell, type SpellOutcome } from '../services/spellLibrary';
import logger from '../utils/logger';

const router = Router();

/** Whether this process is running the import; a second one answers 409 at once. */
let seedInProgress = false;

// Any signed-in user: a GM's library says whether there is anything to import.
router.get('/seed/status', authenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = await getSpellSeedStatus(prisma);
    return res.json({ ...status, seedInProgress, canSeed: req.session.platformRole === 'ADMIN' });
  } catch (error) {
    logger.error('Error checking spell seed status:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to check spell seed status' });
  }
});

router.post('/seed', adminOnly, async (_req: AuthenticatedRequest, res: Response) => {
  if (seedInProgress) {
    return res.status(409).json({ error: 'Conflict', message: 'The SRD spells are being imported already. Please wait.' });
  }
  seedInProgress = true;
  try {
    const result = await seedSrdSpells(prisma);
    return res.json({ message: 'SRD spell import complete', ...result });
  } catch (error) {
    if (error instanceof SeedSourceError) {
      logger.warn('SRD spell import stopped', { reason: error.message });
      return res.status(502).json({ error: 'Bad Gateway', message: error.message });
    }
    logger.error('Error seeding SRD spells:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to import the SRD spells. Check that the server can reach api.open5e.com.',
    });
  } finally {
    seedInProgress = false;
  }
});

/** Send a library write's outcome, or a 500 for what went wrong in the server. */
export async function sendSpellOutcome(res: Response, write: () => Promise<SpellOutcome>): Promise<void> {
  try {
    const outcome = await write();
    res.status(outcome.status).json(outcome.body);
  } catch (error) {
    logger.error('Error writing a spell:', error);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to save the spell' });
  }
}

// The instance's own spells: no campaign, source custom.
router.post('/', adminOnly, (req: AuthenticatedRequest, res: Response) =>
  sendSpellOutcome(res, () => createSpell(null, req.session.userId!, req.body)));

router.put('/:spellId', adminOnly, (req: AuthenticatedRequest, res: Response) =>
  sendSpellOutcome(res, () => updateSpell(null, req.params.spellId, req.body)));

router.delete('/:spellId', adminOnly, (req: AuthenticatedRequest, res: Response) =>
  sendSpellOutcome(res, () => deleteSpell(null, req.params.spellId)));

export default router;
