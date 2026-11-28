/**
 * How many table actions one GM may send over REST: chat, dice, the vibe,
 * atmosphere, spell areas and explored-memory resets.
 *
 * The web client sends these over the socket, where each event has its own
 * ceiling (SOCKET_CEILINGS). Over REST they come from scripts and the MCP
 * bridge, which sends one request per tool call and at most about a hundred
 * for one batch, so 120 a minute lets a batch through and stops a loop. One
 * budget per user across all of these routes.
 */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import type { AuthenticatedRequest } from './rbac';

export const GM_ACTIONS_PER_MINUTE = 120;

export const gmActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: GM_ACTIONS_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `gm-action:${(req as AuthenticatedRequest).session?.userId ?? (req.ip ? ipKeyGenerator(req.ip) : 'anonymous')}`,
  message: { error: 'Too Many Requests', message: 'Too many table actions at once. Wait a minute, then try again.' },
});
