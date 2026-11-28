// Added for Mistwarden on 2026-11-28.
/**
 * How often one user may open or reset their practice campaign
 * (POST /api/campaigns/practice, POST /api/campaigns/:campaignId/practice/reset).
 *
 * Making or resetting one writes its pictures again through sharp and
 * rebuilds a map in one transaction. A person presses the button a few times
 * in an evening; 20 an hour is far above that and stops a script repeating it.
 */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import type { AuthenticatedRequest } from './rbac';

export const PRACTICE_CAMPAIGN_REQUESTS_PER_HOUR = 20;

export const practiceCampaignLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: PRACTICE_CAMPAIGN_REQUESTS_PER_HOUR,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `practice:${(req as AuthenticatedRequest).session?.userId ?? (req.ip ? ipKeyGenerator(req.ip) : 'anonymous')}`,
  message: { error: 'Too Many Requests', message: 'The practice campaign was opened or reset too often. Try again in an hour.' },
});
