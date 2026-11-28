// Added for Mistwarden on 2026-11-28.
/**
 * The practice campaign: one per user, opened from the dashboard, with a
 * small map that has something of everything to try, and a reset that puts
 * it back as it was.
 *
 * Its content goes through the checks every other way in goes through: the
 * campaign's fields through the create schema, the map, its tokens, walls,
 * doors, light and fog through the campaign importer's prepareMap (which
 * holds each to what the map, token, wall and light routes store), the
 * character through its game system's sheet schema, the note and the
 * gallery picture through their routes' schemas. Anything any of them would
 * change or leave out stops the build, so what is stored is what is written
 * below. The pictures are bundled with the backend (assets/practice, drawn
 * by scripts/render-practice-pictures.js) and stored as the ZIP import
 * stores a picture: copied into the campaign's uploads folder, written again
 * by sharp, with a thumbnail.
 *
 * Only the server sets Campaign.isPractice, here; no route writes it and an
 * import never carries it.
 */

import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { CreateCampaignSchema } from '../validators/campaigns';
import { CreatePersonalNoteSchema } from '../validators/personalNotes';
import { AddGalleryPictureSchema } from '../validators/gallery';
import { CreateCharacterSchema } from '../validators/characters';
import { validateTokenShapes } from '../validators/tokens';
import { applyIdentityToSheet, validateCharacterData } from '../validators/game-systems';
import { ImportReport, prepareMap } from './campaignImportContent';
import { DEFAULT_VIBE_SETTINGS } from '../utils/vibe-presets';
import { toJson } from '../utils/prisma-json';
import { holdOwnerCreates } from '../utils/ownerLimit';
import { addToMemberCharacters } from '../utils/memberCharacters';
import { deleteFile, ensureDirectory, getFilePath, writeFileAtomically } from '../utils/fileUtils';
import { reencodePicture } from '../utils/reencodePicture';
import { generateThumbnail } from '../utils/thumbnails';
import logger from '../utils/logger';

/** Where the bundled pictures are: backend/assets/practice, beside src and dist alike. */
export const PRACTICE_PICTURES_DIR = path.resolve(__dirname, '../../assets/practice');

/** The tag the practice campaign's own pictures carry, which a reset finds them by. */
export const PRACTICE_TAG = 'practice campaign';

export const PRACTICE_CAMPAIGN_NAME = 'Practice campaign';
export const PRACTICE_CHARACTER_NAME = 'Practice Hero';
export const PRACTICE_NOTE_TITLE = 'How this practice campaign works';

const SQ = 70;
const COLS = 24;
const ROWS = 18;

/** The bundled pictures, by the file each is drawn into. */
const PICTURES = {
  map: { file: 'courtyard.png', name: 'Practice courtyard' },
  notice: { file: 'practice-notice.png', name: 'Practice notice' },
} as const;
type PictureKey = keyof typeof PICTURES;

const NOTE_TEXT = [
  'This campaign is for trying things out. Nothing here matters, and Reset practice campaign in Campaign Settings puts it back as it was.',
  '',
  'Try these:',
  '- Invite a player, then give them the Scout or the Warden: open the token and set who controls it.',
  '- The fog hides the storehouse and the cellar. Reveal them with the fog tools.',
  '- The storehouse door is open; the cellar door is closed. Open and close doors from the wall tools.',
  '- A lantern burns by the storehouse door. Lights are in the light tools.',
  '- Add the Wolf and the Skeleton to the initiative tracker and run a round.',
  '- Show the Practice notice to your players from the Gallery.',
  '- Practice Hero is a sample 5E character with darkvision.',
  '',
  'A reset keeps the members and their characters; maps, notes, the gallery, spell areas, drawings and the initiative order start over.',
].join('\n');

/** A wall from one point to another, in squares. */
const wall = (x1: number, y1: number, x2: number, y2: number, type = 'wall') =>
  ({ x1: x1 * SQ, y1: y1 * SQ, x2: x2 * SQ, y2: y2 * SQ, type });

/** The walls follow the drawing: outer walls with a gate on the west, the storehouse and cellar on the east. */
const WALLS = [
  wall(1, 1, 23, 1),
  wall(1, 17, 23, 17),
  wall(1, 1, 1, 7),
  wall(1, 10, 1, 17),
  wall(23, 1, 23, 17),
  // The building's west wall, with the storehouse door.
  wall(16, 1, 16, 4),
  wall(16, 4, 16, 5, 'door-open'),
  wall(16, 5, 16, 17),
  // Between storehouse and cellar, with the cellar door.
  wall(16, 8.5, 19, 8.5),
  wall(19, 8.5, 20, 8.5, 'door-closed'),
  wall(20, 8.5, 23, 8.5),
];

/** The lantern outside the storehouse door. */
const LIGHTS = [{ x: 15 * SQ, y: 4.5 * SQ, brightRadius: 2, dimRadius: 4, color: '#ffcc66', enabled: true }];

/** The courtyard is revealed; the storehouse and the cellar (from column 16 on) are fogged. */
function practiceFog() {
  const revealed: boolean[] = [];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) revealed.push(col < 16);
  return { fogCols: COLS, fogRows: ROWS, cellPx: SQ, revealed };
}

const token = (fields: { name: string } & Record<string, unknown>) => ({
  size: { width: 1, height: 1 },
  layer: 'token',
  visible: true,
  rotation: 0,
  conditions: [],
  showHpBar: false,
  notes: '',
  displayMode: 'pog',
  ...fields,
});

/** A token's square, given by column and row from the top; a stored token position counts rows from the map's bottom (frontend utils/tokenCentre.ts). */
const at = (col: number, row: number) => ({ x: col, y: ROWS - 1 - row });

/** Two friendly tokens with no controller for the GM to hand out, two hostile and one neutral. */
const TOKENS = [
  token({ name: 'Scout', type: 'player', disposition: 'friendly', icon: 'ranger', position: at(2, 8), hp: { current: 10, max: 10, temp: 0 }, showHpBar: true }),
  token({ name: 'Warden', type: 'player', disposition: 'friendly', icon: 'fighter', position: at(2, 9), hp: { current: 12, max: 12, temp: 0 }, showHpBar: true }),
  token({ name: 'Wolf', type: 'npc', disposition: 'hostile', icon: 'beast', position: at(12, 13), hp: { current: 11, max: 11, temp: 0 } }),
  token({ name: 'Skeleton', type: 'npc', disposition: 'hostile', icon: 'undead', position: at(20, 13), hp: { current: 13, max: 13, temp: 0 } }),
  token({ name: 'Merchant', type: 'npc', disposition: 'neutral', icon: 'humanoid', position: at(6, 4), notes: 'Sells rope and lamp oil.' }),
];

/** The sample character's sheet: made-up numbers, a level 1 fighter with darkvision 60 ft. */
const HERO_SHEET = {
  class: 'Fighter',
  level: 1,
  race: 'Dwarf',
  proficiencyBonus: 2,
  armorClass: 16,
  darkvisionFeet: 60,
  hp: { maximum: 12, current: 12, temporary: 0 },
  stats: {
    strength: { score: 16, modifier: 3 },
    dexterity: { score: 12, modifier: 1 },
    constitution: { score: 14, modifier: 2 },
    intelligence: { score: 10, modifier: 0 },
    wisdom: { score: 13, modifier: 1 },
    charisma: { score: 8, modifier: -1 },
  },
};

/** Why a practice campaign could not be made or reset; a fault in the content above, never the caller's. */
export class PracticeContentError extends Error {}

/** A bundled picture stored in a campaign's uploads folder, its row not yet written. */
interface StoredPicture {
  key: PictureKey;
  row: Prisma.AssetCreateManyInput;
}

/** Copy, re-encode and thumbnail one bundled picture into the campaign's map folder. */
async function storePicture(key: PictureKey, campaignId: string, userId: string): Promise<StoredPicture> {
  const { file, name } = PICTURES[key];
  const dir = getFilePath('MAP', 'CAMPAIGN', campaignId);
  await ensureDirectory(dir);
  const id = randomUUID();
  const filePath = path.join(dir, `${id}.png`);
  let thumbnailPath: string | null = null;
  try {
    await fs.copyFile(path.join(PRACTICE_PICTURES_DIR, file), filePath);
    const written = await reencodePicture(filePath);
    if (written) await writeFileAtomically(filePath, written);
    thumbnailPath = await generateThumbnail(filePath);
    const { size } = await fs.stat(filePath);
    return {
      key,
      row: {
        id, type: 'MAP', scope: 'CAMPAIGN', uploadedById: userId, campaignId,
        filename: path.basename(filePath), originalName: file, mimeType: 'image/png', fileSize: size,
        filePath: filePath.replace(/\\/g, '/'), thumbnailPath, name, description: null, tags: [PRACTICE_TAG],
      },
    };
  } catch (error) {
    await removeFiles([filePath, thumbnailPath]);
    throw error;
  }
}

async function removeFiles(files: Array<string | null | undefined>): Promise<void> {
  for (const file of files) {
    if (file) await deleteFile(file).catch((err) => logger.error('Could not remove a practice picture left behind', { err }));
  }
}

const filesOf = (stored: StoredPicture[]) => stored.flatMap((p) => [p.row.filePath, p.row.thumbnailPath]);

/** The map as prepareMap takes one from an archive, its picture named by asset id. */
export function practiceMapSource(mapAssetId: string) {
  return {
    name: 'Practice courtyard',
    imageAssetRef: mapAssetId,
    width: COLS,
    height: ROWS,
    gridSize: SQ,
    gridType: 'square',
    feetPerSquare: 5,
    diagonalRule: 'flat',
    snapTokens: true,
    tokens: TOKENS,
    wallSegments: WALLS,
    lights: LIGHTS,
    fogData: practiceFog(),
    fogEnabled: true,
    lightingEnabled: true,
    globalIllumination: true,
    explorationEnabled: true,
  };
}

/** The map, ready to write, or a PracticeContentError naming what a check changed or left out. */
export function preparePracticeMap(mapAssetId: string) {
  for (const t of TOKENS) {
    const shapes = validateTokenShapes(t);
    if (!shapes.ok) throw new PracticeContentError(`Practice token ${t.name}: ${shapes.message}`);
  }
  const report = new ImportReport();
  const isMapPicture = (ref: string) => ref === mapAssetId;
  const prepared = prepareMap(practiceMapSource(mapAssetId), {
    index: 0,
    importTokens: true,
    remapAsset: (ref) => (ref === mapAssetId ? `/api/assets/maps/${mapAssetId}` : null),
    isMapPicture,
    isTokenPicture: () => false,
    report,
  });
  const { warnings, skipped } = report.result();
  if (!prepared || warnings.length > 0 || skipped.length > 0 || prepared.data.fogData === null) {
    throw new PracticeContentError(`The practice map does not pass its checks: ${JSON.stringify({ warnings, skipped })}`);
  }
  return prepared;
}

/** The sample character's sheet as its game system's schema keeps it. */
function heroSheet(ownerName: string) {
  const sheet = applyIdentityToSheet('FIFTH_EDITION', HERO_SHEET, PRACTICE_CHARACTER_NAME, ownerName);
  const checked = validateCharacterData('FIFTH_EDITION', sheet);
  if (!checked.success) throw new PracticeContentError(`Practice Hero's sheet does not pass its checks: ${checked.errors.issues[0]?.message}`);
  return checked.data;
}

/**
 * Write the content into a campaign that has none: the map (made current),
 * the gallery picture, the GM's note and the sample character, which is
 * put back as it was when the campaign still has it.
 */
async function writeContent(tx: Prisma.TransactionClient, campaignId: string, gmId: string, assets: Record<PictureKey, string>): Promise<string> {
  const prepared = preparePracticeMap(assets.map);
  const mapId = randomUUID();
  await tx.map.create({ data: { ...prepared.data, id: mapId, campaignId } });
  await tx.campaign.update({ where: { id: campaignId }, data: { currentMapId: mapId } });

  const picture = AddGalleryPictureSchema.parse({ assetId: assets.notice, name: PICTURES.notice.name, folder: 'Handouts' });
  await tx.galleryPicture.create({ data: { campaignId, assetId: picture.assetId, name: picture.name, folder: picture.folder ?? '' } });

  const note = CreatePersonalNoteSchema.parse({ title: PRACTICE_NOTE_TITLE, content: NOTE_TEXT });
  await tx.personalNote.create({ data: { userId: gmId, campaignId, title: note.title, content: note.content ?? '' } });

  const gm = await tx.user.findUniqueOrThrow({ where: { id: gmId }, select: { displayName: true } });
  const sheet = toJson(heroSheet(gm.displayName));
  const hero = await tx.character.findFirst({ where: { campaignId, userId: gmId, name: PRACTICE_CHARACTER_NAME }, select: { id: true } });
  if (hero) {
    await tx.character.update({ where: { id: hero.id }, data: { data: sheet, gameSystem: 'FIFTH_EDITION' } });
  } else {
    const fields = CreateCharacterSchema.parse({ name: PRACTICE_CHARACTER_NAME, gameSystem: 'FIFTH_EDITION', campaignId });
    const created = await tx.character.create({
      data: { userId: gmId, name: fields.name, data: sheet, gameSystem: 'FIFTH_EDITION', campaignId, tokenImageUrl: null },
    });
    await addToMemberCharacters(tx, gmId, campaignId, created.id);
  }
  return mapId;
}

const assetIds = (stored: StoredPicture[], kept: Partial<Record<PictureKey, string>> = {}) =>
  ({ ...kept, ...Object.fromEntries(stored.map((p) => [p.key, p.row.id as string])) }) as Record<PictureKey, string>;

/** The practice campaign `userId` runs as GM, if any. */
export async function findPracticeCampaign(userId: string) {
  return prisma.campaign.findFirst({
    where: { isPractice: true, memberships: { some: { userId, role: 'GM' } } },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * The practice campaign `userId` runs, made now if they have none. One per
 * user: the find and the create are held in line per user, so two requests
 * at once make one.
 */
export async function openPracticeCampaign(userId: string): Promise<{ campaignId: string; created: boolean }> {
  const existing = await findPracticeCampaign(userId);
  if (existing) return { campaignId: existing.id, created: false };

  const campaignId = randomUUID();
  const stored: StoredPicture[] = [];
  try {
    for (const key of Object.keys(PICTURES) as PictureKey[]) stored.push(await storePicture(key, campaignId, userId));
    const fields = CreateCampaignSchema.parse({
      name: PRACTICE_CAMPAIGN_NAME,
      description: 'A small campaign to try things out in. Reset it from Campaign Settings.',
      gameSystem: 'FIFTH_EDITION',
    });
    const outcome = await prisma.$transaction(async (tx) => {
      await holdOwnerCreates(tx, 'practice-campaign', userId);
      const other = await tx.campaign.findFirst({
        where: { isPractice: true, memberships: { some: { userId, role: 'GM' } } },
        select: { id: true },
      });
      if (other) return { campaignId: other.id, created: false };
      await tx.campaign.create({
        data: {
          id: campaignId, name: fields.name, description: fields.description ?? '', gameSystem: fields.gameSystem ?? null,
          ownerId: userId, vibeSettings: toJson(DEFAULT_VIBE_SETTINGS), isPractice: true,
        },
      });
      await tx.campaignMembership.create({ data: { userId, campaignId, role: 'GM', characterIds: [] } });
      await tx.asset.createMany({ data: stored.map((p) => p.row) });
      await writeContent(tx, campaignId, userId, assetIds(stored));
      return { campaignId, created: true };
    }, { timeout: 20_000 });
    if (!outcome.created) await removeFiles(filesOf(stored));
    return outcome;
  } catch (error) {
    await removeFiles(filesOf(stored));
    throw error;
  }
}

export type ResetOutcome = { reset: true; mapId: string } | { reset: false; reason: 'not-found' | 'not-practice' };

/**
 * Put a practice campaign back as it was made. Its maps go, and with them
 * their drawings, spell areas and explored memory; its notes and gallery go;
 * its dice history is cleared (the watermark the dice panel's clear sets).
 * The members, their characters and the campaign's own pictures stay; the
 * sample character's sheet is put back, or the character made again if it
 * was deleted. The initiative order, kept in memory, is the caller's to clear.
 */
export async function resetPracticeCampaign(campaignId: string, gmId: string): Promise<ResetOutcome> {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { isPractice: true } });
  if (!campaign) return { reset: false, reason: 'not-found' };
  if (!campaign.isPractice) return { reset: false, reason: 'not-practice' };

  // The campaign's own pictures are used again; one the GM deleted is stored anew.
  const existing = await prisma.asset.findMany({
    where: { campaignId, scope: 'CAMPAIGN', type: 'MAP', tags: { has: PRACTICE_TAG } },
    select: { id: true, originalName: true },
  });
  const kept: Partial<Record<PictureKey, string>> = {};
  for (const key of Object.keys(PICTURES) as PictureKey[]) {
    const found = existing.find((a) => a.originalName === PICTURES[key].file);
    if (found) kept[key] = found.id;
  }
  const stored: StoredPicture[] = [];
  try {
    for (const key of Object.keys(PICTURES) as PictureKey[]) if (!kept[key]) stored.push(await storePicture(key, campaignId, gmId));
    const outcome = await prisma.$transaction(async (tx): Promise<ResetOutcome> => {
      // Under the campaign's row lock, which making a map current and deleting one also take.
      const [row] = await tx.$queryRaw<Array<{ isPractice: boolean }>>`SELECT "isPractice" FROM "Campaign" WHERE id = ${campaignId} FOR UPDATE`;
      if (!row) return { reset: false, reason: 'not-found' };
      if (!row.isPractice) return { reset: false, reason: 'not-practice' };
      await tx.campaign.update({ where: { id: campaignId }, data: { currentMapId: null, rollHistoryClearedAt: new Date() } });
      await tx.map.deleteMany({ where: { campaignId } });
      await tx.galleryPicture.deleteMany({ where: { campaignId } });
      await tx.personalNote.deleteMany({ where: { campaignId } });
      if (stored.length > 0) await tx.asset.createMany({ data: stored.map((p) => p.row) });
      const mapId = await writeContent(tx, campaignId, gmId, assetIds(stored, kept));
      return { reset: true, mapId };
    }, { timeout: 20_000 });
    if (!outcome.reset) await removeFiles(filesOf(stored));
    return outcome;
  } catch (error) {
    await removeFiles(filesOf(stored));
    throw error;
  }
}
