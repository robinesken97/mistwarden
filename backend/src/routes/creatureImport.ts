/**
 * The instance's imported creatures (services/creatureImport.ts): reading
 * stat blocks from a Markdown file under a source tag, deleting a tag's, and
 * giving them the server's token pictures of their names. Platform admins
 * only, as the SRD import is: every campaign's GM lists what is stored here.
 * Mounted at /api/creatures.
 *
 * No limiter of its own, as the spell and SRD imports have none: every
 * request is an administrator's, the writes take one lock in turn, and the
 * general /api limit (app.ts) covers the rest.
 */

import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/rbac';
import { adminOnly } from '../middleware/compose';
import { importCreatureMarkdown, deleteImportedCreatures, matchTokenPictures, type ImportOutcome } from '../services/creatureImport';
import logger from '../utils/logger';

const router = Router();

async function send(res: Response, work: () => Promise<ImportOutcome>, failure: string): Promise<void> {
  try {
    const outcome = await work();
    res.status(outcome.status).json(outcome.body);
  } catch (error) {
    logger.error(`${failure}:`, error);
    res.status(500).json({ error: 'Internal Server Error', message: failure });
  }
}

router.post('/import-markdown', adminOnly, (req: AuthenticatedRequest, res: Response) =>
  send(res, () => importCreatureMarkdown(req.body), 'Failed to import the stat blocks'));

router.delete('/imported/:sourceTag', adminOnly, (req: AuthenticatedRequest, res: Response) =>
  send(res, () => deleteImportedCreatures(req.params.sourceTag), 'Failed to delete the imported creatures'));

router.post('/match-token-pictures', adminOnly, (req: AuthenticatedRequest, res: Response) =>
  send(res, () => matchTokenPictures(req.body), 'Failed to match token pictures'));

export default router;
