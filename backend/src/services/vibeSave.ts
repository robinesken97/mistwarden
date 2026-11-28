// ============================================
// What saving the vibe periods does to the table
// ============================================
//
// Every member's page shows the periods and the vibe's tint, so a save sends
// each of them the periods as saved and the vibe they leave. The vibe owns the
// soundtrack (see atmosphereAudio), so its track follows the period in force:
// an edited period's new track plays, and a vibe that ends takes its track
// with it. A track the GM put on over the vibe from the Atmosphere panel is
// left playing.

import { Server } from 'socket.io';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { findVibePeriod, normalizeVibeSettings } from '../utils/vibe-presets';
import { vibePeriodAudioAssetId } from '../utils/vibeAudio';
import { readJsonObject } from '../utils/prisma-json';
import { getSocketInstance, sendSystemMessage } from '../websocket/utils';
import logger from '../utils/logger';
import type { VibeSettingsInput } from '../validators/campaigns';
import { lastAmbientVolume, setCampaignAmbientAudio } from './atmosphereAudio';
import { canReadAsset } from './permissions';
import { replaceVibeSettingsKeepingLive } from './vibeSettingsColumn';

/**
 * Why a period's track cannot be saved, or null when each can be. A period's
 * audio names an asset the whole table fetches while that period is the vibe,
 * so the save asks the same question the ambient setter asks: may this GM
 * open this track to the room? Never as an admin, for the same reason the
 * setter refuses that.
 */
export async function vibeAudioRefusal(
  campaignId: string,
  actingUserId: string,
  settings: Pick<VibeSettingsInput, 'periods'>,
): Promise<string | null> {
  const checked = new Map<string, boolean>();
  for (const period of settings.periods) {
    if (period.audio === null) continue;
    const assetId = vibePeriodAudioAssetId(period.audio);
    let allowed = false;
    if (assetId) {
      if (checked.has(assetId)) {
        allowed = checked.get(assetId) === true;
      } else {
        const asset = await prisma.asset.findUnique({ where: { id: assetId } });
        allowed = !!asset
          && asset.type === 'AUDIO'
          && !(asset.scope === 'CAMPAIGN' && asset.campaignId !== campaignId)
          && (await canReadAsset(asset, actingUserId, false));
        checked.set(assetId, allowed);
      }
    }
    if (!allowed) return `The "${period.name}" period's audio must be an audio track available to this campaign, or none`;
  }
  return null;
}

/**
 * Save a campaign's vibe settings, for both routes that take them. The
 * stored track and weather are kept (replaceVibeSettingsKeepingLive); the period in
 * force stays the vibe under its saved spelling, written only while it is
 * still the one read, so a switch made meanwhile stands, and the vibe ends
 * once that period is renamed or deleted. The table is then told
 * (announceVibeSave). The periods' tracks must have passed vibeAudioRefusal.
 */
export async function saveVibeSettings(
  campaignId: string,
  actingUserId: string,
  settings: VibeSettingsInput,
): Promise<{ vibeSettings: Prisma.JsonValue; currentVibe: string | null }> {
  const before = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { currentVibe: true, vibeSettings: true },
  });
  await replaceVibeSettingsKeepingLive(campaignId, settings);
  const vibeBefore = before?.currentVibe ?? null;
  const vibeAfter = vibeAfterSave(settings, vibeBefore);
  if (vibeAfter !== vibeBefore) {
    await prisma.campaign.updateMany({
      where: { id: campaignId, currentVibe: vibeBefore },
      data: { currentVibe: vibeAfter },
    });
  }
  const saved = await prisma.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    select: { vibeSettings: true, currentVibe: true },
  });

  // The save is stored; a failure to tell the table is logged, and the
  // pages catch up when they next load the campaign.
  try {
    await announceVibeSave(getSocketInstance(), campaignId, actingUserId, {
      currentVibe: vibeBefore,
      vibeSettings: before?.vibeSettings ?? null,
    }, saved);
  } catch (err) {
    logger.warn('Vibe save not broadcast', { err, campaignId });
  }
  return saved;
}

/**
 * The vibe a save leaves: the period in force under its saved spelling, or
 * none once it is renamed or deleted. Periods are matched ignoring case, as
 * a switch matches them, so a change only to a period's capitals keeps it in
 * force; pages match the stored name exactly, so it takes the new spelling.
 */
export function vibeAfterSave(saved: { periods: readonly { name: string }[] }, currentVibe: string | null): string | null {
  if (!currentVibe) return null;
  return findVibePeriod(saved, currentVibe)?.name ?? null;
}

/** The track the table is playing, from a campaign's stored vibe settings. */
function playingTrack(vibeSettings: Prisma.JsonValue): string | null {
  const audio = readJsonObject(vibeSettings)?.atmosphereAudio;
  if (!audio || typeof audio !== 'object' || Array.isArray(audio)) return null;
  const assetId = (audio as Record<string, unknown>).assetId;
  return typeof assetId === 'string' ? assetId : null;
}

/**
 * Tell the table about a save, and move the soundtrack with the vibe.
 *
 * `before` is the campaign as it was stored before the save, `saved` as it
 * is stored after it: its vibe and what is playing are read fresh, so a
 * switch that landed meanwhile, and the track that switch started, are left
 * as they are. Every period's track was checked before the save was stored,
 * so a refusal here is a track removed in between: the table is then
 * silenced, as a switch to that period would.
 */
export async function announceVibeSave(
  io: Server,
  campaignId: string,
  actingUserId: string,
  before: { currentVibe: string | null; vibeSettings: Prisma.JsonValue },
  saved: { currentVibe: string | null; vibeSettings: Prisma.JsonValue },
): Promise<void> {
  io.to(campaignId).emit('vibe.settings.updated', {
    campaignId,
    vibeSettings: saved.vibeSettings,
    currentVibe: saved.currentVibe,
    updatedBy: actingUserId,
    timestamp: new Date().toISOString(),
  });

  if (!before.currentVibe) return;
  const was = findVibePeriod(normalizeVibeSettings(before.vibeSettings), before.currentVibe);
  const now = saved.currentVibe ? findVibePeriod(normalizeVibeSettings(saved.vibeSettings), saved.currentVibe) : null;
  const oldTrack = was ? vibePeriodAudioAssetId(was.audio) : null;
  const newTrack = now ? vibePeriodAudioAssetId(now.audio) : null;
  const playing = playingTrack(saved.vibeSettings);
  const vibeHasTheSoundtrack = playing === null || playing === oldTrack;
  if (newTrack === oldTrack || !vibeHasTheSoundtrack || playing === newTrack) return;

  const volume = await lastAmbientVolume(campaignId);
  const result = await setCampaignAmbientAudio(io, campaignId, actingUserId, newTrack, { volume });
  if (!result.ok) await setCampaignAmbientAudio(io, campaignId, actingUserId, null, { volume });
}

/** What a switch of the vibe answers: refused with the GM's message, or done with a notice when the period's track could not play. */
export type VibeSwitchOutcome =
  | { ok: true; period: string; audioNotice?: string }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * Switch the campaign's vibe to `period`, for the socket's vibe.update and
 * REST alike. Every member is sent `vibe.updated`, the period's track
 * becomes the table's ambient audio (none means silence), and the chat gets
 * a system message. A dead or forbidden track silences the table and is
 * answered as `audioNotice`, but never blocks the switch.
 */
export async function switchVibe(io: Server, campaignId: string, actingUserId: string, period: unknown): Promise<VibeSwitchOutcome> {
  if (!period || typeof period !== 'string') {
    return { ok: false, status: 400, error: 'period (string) is required' };
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { vibeSettings: true, currentVibe: true },
  });
  if (!campaign) return { ok: false, status: 404, error: 'Campaign not found' };

  // Normalize settings to handle old and new formats
  const vibeSettings = normalizeVibeSettings(campaign.vibeSettings);
  if (!vibeSettings.enabled) {
    return { ok: false, status: 409, error: 'Vibe tracker is not enabled for this campaign' };
  }

  const vibePeriod = findVibePeriod(vibeSettings, period);
  if (!vibePeriod) {
    const availablePeriods = vibeSettings.periods.map((p: { name: string }) => p.name).join(', ');
    return { ok: false, status: 400, error: `Unknown vibe period '${period}'. Available: ${availablePeriods}` };
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { currentVibe: vibePeriod.name },
  });

  // To all campaign members, the sender included for confirmation.
  io.to(campaignId).emit('vibe.updated', {
    period: vibePeriod.name,
    hue: vibePeriod.hue,
    filter: vibePeriod.filter,
    audio: vibePeriod.audio,
    updatedBy: actingUserId,
    timestamp: new Date().toISOString(),
  });

  // The vibe owns the soundtrack: a period with a track starts it for
  // the table, one without silences it. Older settings carried free-text
  // notes in this field; those count as no track.
  let audioNotice: string | undefined;
  const requestedAudio = vibePeriodAudioAssetId(vibePeriod.audio);
  const volume = await lastAmbientVolume(campaignId);
  const audioResult = await setCampaignAmbientAudio(io, campaignId, actingUserId, requestedAudio, { volume });
  if (!audioResult.ok) {
    await setCampaignAmbientAudio(io, campaignId, actingUserId, null, { volume });
    audioNotice = `The "${vibePeriod.name}" period's audio track is unavailable, so the vibe changed without audio`;
  }

  const periodDisplayName = vibePeriod.name.charAt(0).toUpperCase() + vibePeriod.name.slice(1);
  await sendSystemMessage(
    campaignId,
    `Time advances to ${periodDisplayName}.`,
    { userId: actingUserId, action: 'vibe.update', period: vibePeriod.name }
  );

  logger.info('vibe.update', { period: vibePeriod.name, userId: actingUserId, campaignId });
  return { ok: true, period: vibePeriod.name, ...(audioNotice ? { audioNotice } : {}) };
}
