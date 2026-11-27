// Added for Mistwarden on 2026-11-27.
// ============================================
// Writing help for a campaign's GM (services/aiWriter.ts): an NPC, a passage
// to read aloud, or notes. GM only; the text goes back to the GM alone, who
// decides what to keep. Mounted under /api/campaigns.
// ============================================

import { Router, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middleware/rbac';
import { campaignGM } from '../middleware/compose';
import { prisma } from '../config/database';
import { positiveIntegerFromEnv } from '../config/env';
import { AI_KINDS, AiNotConfiguredError, AiProviderError, writeForGm } from '../services/aiWriter';
import logger from '../utils/logger';

const router = Router();

/** Each request costs the instance's owner money or their GPU's time. */
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: positiveIntegerFromEnv('AI_RATE_LIMIT', 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const session = (req as AuthenticatedRequest).session;
    return session?.userId ?? (req.ip ? ipKeyGenerator(req.ip) : 'anonymous');
  },
  message: { error: 'Too Many Requests', message: 'Too many AI requests. Please wait a minute.' },
});

const WriteSchema = z
  .object({
    kind: z.enum(AI_KINDS, { error: 'kind must be npc, read-aloud or note' }),
    prompt: z.string().trim().min(1, 'Say what to write').max(2000, 'A request can be at most 2,000 characters'),
  })
  .strict();

/**
 * POST /api/campaigns/:campaignId/ai/write
 * Write an NPC, a passage to read aloud, or notes from the GM's request.
 * Requires: Campaign GM role. 503 when the server has no AI configured.
 */
router.post('/:campaignId/ai/write', campaignGM, aiLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const parsed = WriteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation Error', message: parsed.error.issues[0]?.message ?? 'Invalid request' });
  }
  try {
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: req.params.campaignId }, select: { name: true, gameSystem: true } });
    const text = await writeForGm(parsed.data.kind, parsed.data.prompt, campaign);
    return res.json({ text });
  } catch (error) {
    if (error instanceof AiNotConfiguredError) {
      return res.status(503).json({ error: 'Service Unavailable', message: error.message });
    }
    if (error instanceof AiProviderError) {
      logger.warn('AI writing failed', { reason: error.message });
      return res.status(502).json({ error: 'Bad Gateway', message: error.message });
    }
    logger.error('Error writing with AI', { err: error });
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to write the text' });
  }
});

export default router;
