// Added for Mistwarden on 2026-11-27.
/**
 * Import of a ZIP of pictures into the asset library.
 *
 * A collection of token or map pictures, folders and all, becomes one asset
 * per picture: named after its file, tagged with the folders it sits in
 * ("Beasts/Horses/brown horse.png" is "brown horse", tagged Beasts and
 * Horses). Each picture is checked as an upload of its type is (its size
 * limit, its bytes, the picture limits) and then written again by sharp, so
 * no file is served as it arrived.
 *
 * The archive is read with the safe readers of utils/archive.ts: its entry
 * count is checked before its directory is read, every entry unpacks through
 * a counter against its own limit and the archive's, and an entry's name
 * never becomes a path on disk. Entries that are folders, hidden, or macOS
 * resource forks are passed over; unsafe names, links and files of other
 * types are skipped and reported.
 *
 * The pictures are imported one after another after the request has been
 * answered; the page asks for the job's progress (routes/assets.ts).
 */

import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { setImmediate as nextTurn } from 'timers/promises';
import { prisma } from '../config/database';
import { positiveIntegerFromEnv } from '../config/env';
import {
  isSafeArchivePath,
  writeArchiveEntry,
  UnpackedTotal,
  ArchiveLimitError,
  ArchiveRefusedError,
  type ArchiveDirectory,
  type ArchiveEntry,
} from '../utils/archive';
import {
  ALLOWED_EXTENSIONS,
  deleteFile,
  ensureDirectory,
  getFilePath,
  getFileSizeLimit,
  isAllowedExtension,
  writeFileAtomically,
  type AssetScope,
} from '../utils/fileUtils';
import { pictureLimitProblem } from '../utils/pictureLimits';
import { shrinkMapPicture } from '../utils/mapPicture';
import { reencodePicture } from '../utils/reencodePicture';
import { generateThumbnail } from '../utils/thumbnails';
import { cutText } from '../utils/cutText';
import { megabytes } from '../utils/campaignArchiveSize';
import { tidyTags, isDrawnMapTag } from '../validators/assets';
import { ASSET_LIMITS } from '../validators/assetLimits';
import { identifyAsset, displayName } from './campaignImporter';
import logger from '../utils/logger';

const MB = 1024 * 1024;

/** What one ZIP may be, read once at start; each picture may be as large as an upload of its type. */
export const ASSET_ZIP_LIMITS = {
  /** The largest archive accepted. The bundled nginx lets 512 MB through on this route. */
  maxArchiveBytes: positiveIntegerFromEnv('ASSET_ZIP_MAX_MB', 500) * MB,
  /** The most entries, folders included, the archive's directory may list. */
  maxEntries: positiveIntegerFromEnv('ASSET_ZIP_MAX_FILES', 5000),
  /** The most all its entries may unpack to together. */
  maxUnpackedBytes: positiveIntegerFromEnv('ASSET_ZIP_MAX_UNPACKED_MB', 2048) * MB,
};
export type AssetZipLimits = typeof ASSET_ZIP_LIMITS;

/** The kinds of asset a ZIP can be imported as. */
export const ZIP_ASSET_TYPES = ['TOKEN', 'MAP'] as const;
export type ZipAssetType = (typeof ZIP_ASSET_TYPES)[number];

export interface ZipImportOptions {
  userId: string;
  type: ZipAssetType;
  scope: AssetScope;
  /** Set for CAMPAIGN scope only. */
  campaignId: string | null;
  /** Tags given to every picture, beside its folders'. */
  extraTags: string[];
  /** Leave out the folder every picture sits in, when there is one (a downloaded folder's own name). */
  dropTopFolder: boolean;
  /** Import a picture whose name and tags an asset of the library already has. */
  allowDuplicates: boolean;
}

/** One picture the archive offers, with what it will be called. */
export interface PlannedPicture {
  entry: ArchiveEntry;
  name: string;
  tags: string[];
}

export interface SkippedFile {
  file: string;
  reason: string;
}

/** How many skipped files and duplicates a job lists by name; the rest are counted. */
const LISTED = 500;

export interface ZipImportJob {
  id: string;
  userId: string;
  status: 'running' | 'done' | 'failed';
  /** Pictures to import, after the passed-over and skipped entries. */
  total: number;
  processed: number;
  imported: { id: string; name: string }[];
  skipped: SkippedFile[];
  skippedCount: number;
  duplicates: string[];
  duplicateCount: number;
  /** Why the job stopped early, when it did. */
  message?: string;
  finishedAt?: number;
}

/** Entries no one means to import: hidden files and macOS's resource forks. Asked of a safe path only. */
function passedOver(entry: ArchiveEntry): boolean {
  const parts = entry.path.split('/').filter(Boolean);
  return parts[0] === '__MACOSX' || parts.some((part) => part.startsWith('.')) || /^(thumbs\.db|desktop\.ini)$/i.test(parts.at(-1) ?? '');
}

/** A file's name without its extension, as an asset's name: underscores as spaces, spaces collapsed. */
export function nameFromFile(fileName: string): string {
  const base = fileName.normalize('NFC').replace(/\.[^.]*$/, '');
  const tidy = base.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return cutText(tidy || base.trim() || 'Picture', ASSET_LIMITS.maxNameLength);
}

/**
 * The tags of a picture in `folders`, after `extraTags`: tidied as an
 * upload's are, each cut to the longest a tag may be, at most as many as an
 * asset may have, and never the tag reserved for Paint's pictures.
 */
export function tagsFor(folders: readonly string[], extraTags: readonly string[]): string[] {
  const cut = [...extraTags, ...folders].map((tag) => cutText(tag.normalize('NFC').trim(), ASSET_LIMITS.maxTagLength));
  return tidyTags(cut).filter((tag) => !isDrawnMapTag(tag)).slice(0, ASSET_LIMITS.maxTags);
}

/**
 * Sort the archive's entries into the pictures to import and the files
 * skipped, with the reason for each. Nothing is unpacked here.
 */
export function planZipImport(
  directory: ArchiveDirectory,
  options: Pick<ZipImportOptions, 'type' | 'extraTags' | 'dropTopFolder'>
): { pictures: PlannedPicture[]; skipped: SkippedFile[] } {
  const skipped: SkippedFile[] = [];
  const found: { entry: ArchiveEntry; folders: string[]; file: string }[] = [];
  for (const entry of directory.files) {
    if (entry.type === 'Directory') continue;
    if (!isSafeArchivePath(entry.path)) {
      skipped.push({ file: entry.path, reason: 'Its path leaves the archive, or is not a plain relative path.' });
      continue;
    }
    if (passedOver(entry)) continue;
    if (entry.symlink) {
      skipped.push({ file: entry.path, reason: 'It is a link, not a file.' });
      continue;
    }
    const parts = entry.path.split('/').filter(Boolean);
    const file = parts.pop() ?? entry.path;
    if (!isAllowedExtension(options.type, path.extname(file))) {
      skipped.push({ file: entry.path, reason: `Not a picture this kind of asset can be (${ALLOWED_EXTENSIONS[options.type].join(', ')}).` });
      continue;
    }
    found.push({ entry, folders: parts, file });
  }
  const top = found[0]?.folders[0];
  const shareTop = options.dropTopFolder && top !== undefined && found.every((f) => f.folders[0] === top);
  const pictures = found.map(({ entry, folders, file }) => ({
    entry,
    name: nameFromFile(file),
    tags: tagsFor(shareTop ? folders.slice(1) : folders, options.extraTags),
  }));
  return { pictures, skipped };
}

/** Name and tags as a duplicate is recognised by, whatever their case or the tags' order. */
function duplicateKey(name: string, tags: readonly string[]): string {
  return [name.toLowerCase(), ...tags.map((t) => t.toLowerCase()).sort()].join('\u0000');
}

/** The name-and-tags keys of the assets of `type` already in the library the import fills. */
async function keysInLibrary(options: ZipImportOptions): Promise<Set<string>> {
  const rows = await prisma.asset.findMany({
    where: {
      type: options.type,
      scope: options.scope,
      ...(options.scope === 'CAMPAIGN' ? { campaignId: options.campaignId } : {}),
      ...(options.scope === 'USER' ? { uploadedById: options.userId } : {}),
    },
    select: { name: true, tags: true },
  });
  return new Set(rows.map((row) => duplicateKey(row.name, row.tags)));
}

/** A file that is not imported, and why. Thrown by importPicture; any other error stops the job. */
class PictureSkipped extends Error {}

/**
 * Unpack, check, re-encode and store one picture, returning its new row's
 * id. Its files are removed again if anything after the unpacking fails.
 */
async function importPicture(
  archivePath: string,
  picture: PlannedPicture,
  options: ZipImportOptions,
  total: UnpackedTotal
): Promise<string> {
  const { type } = options;
  // Stored where an upload of this type and scope is (relocateUpload).
  const dir = options.scope === 'CAMPAIGN' && options.campaignId
    ? getFilePath(type, 'CAMPAIGN', options.campaignId)
    : getFilePath(type, 'GLOBAL');
  await ensureDirectory(dir);
  const id = randomUUID();
  // Under a name no serving route knows until its bytes say what it is.
  let filePath = path.join(dir, `${id}.importing`);
  let thumbnailPath: string | null = null;
  try {
    const limit = getFileSizeLimit(type);
    try {
      await writeArchiveEntry(archivePath, picture.entry, filePath, { maxEntryBytes: limit, total });
    } catch (error) {
      if (error instanceof ArchiveLimitError && error.limit === 'entry') {
        throw new PictureSkipped(`It is larger than the ${megabytes(limit)} an upload of its kind may be.`);
      }
      if (error instanceof ArchiveLimitError) throw error;
      if (error instanceof ArchiveRefusedError) throw new PictureSkipped(error.message);
      throw error;
    }

    const content = await identifyAsset(filePath, type, picture.entry.path);
    if (!content) {
      throw new PictureSkipped(`Its content is not a picture this kind of asset can be (${ALLOWED_EXTENSIONS[type].join(', ')}).`);
    }
    const problem = await pictureLimitProblem(filePath, type);
    if (problem) throw new PictureSkipped(problem);

    const stored = path.join(dir, `${id}.${content.ext}`);
    await fs.rename(filePath, stored);
    filePath = stored;

    // Written again, never served as it came; a map larger than a tablet holds is shrunk on the way.
    let written: Buffer | null;
    try {
      written = (type === 'MAP' ? await shrinkMapPicture(filePath) : null) ?? (await reencodePicture(filePath));
    } catch {
      throw new PictureSkipped('The picture cannot be read.');
    }
    if (written) await writeFileAtomically(filePath, written);
    const fileSize = (await fs.stat(filePath)).size;
    thumbnailPath = await generateThumbnail(filePath);

    const fileName = path.posix.basename(picture.entry.path).normalize('NFC');
    const row = await prisma.asset.create({
      data: {
        type,
        scope: options.scope,
        uploadedById: options.userId,
        campaignId: options.campaignId,
        filename: path.basename(filePath),
        originalName: displayName(fileName, type, content.ext),
        mimeType: content.mime,
        fileSize,
        filePath: filePath.replace(/\\/g, '/'),
        thumbnailPath,
        name: picture.name,
        description: null,
        tags: picture.tags,
      },
      select: { id: true },
    });
    return row.id;
  } catch (error) {
    for (const leftover of [filePath, thumbnailPath]) {
      if (leftover) await deleteFile(leftover).catch((err) => logger.error('Error removing a picture the ZIP import did not keep', { err }));
    }
    throw error;
  }
}

// shortcut: jobs are kept in this process's memory, so a restart forgets an import's progress (the assets it stored stay); give them a table if imports must outlive a restart.
const jobs = new Map<string, ZipImportJob>();
/** How long a finished job can still be asked about. */
const JOB_KEPT_MS = 60 * 60 * 1000;

function forgetOldJobs(now = Date.now()): void {
  for (const [id, job] of jobs) if (job.finishedAt && now - job.finishedAt > JOB_KEPT_MS) jobs.delete(id);
}

/** The job, if it is `userId`'s. */
export function zipImportJobFor(jobId: string, userId: string): ZipImportJob | undefined {
  const job = jobs.get(jobId);
  return job?.userId === userId ? job : undefined;
}

/** Whether `userId` has an import still running. */
export function hasRunningZipImport(userId: string): boolean {
  return [...jobs.values()].some((job) => job.userId === userId && job.status === 'running');
}

function skip(job: ZipImportJob, file: SkippedFile): void {
  job.skippedCount += 1;
  if (job.skipped.length < LISTED) job.skipped.push(file);
}

/** Import every planned picture, one after another, recording each outcome on `job`. */
export async function runZipImport(
  job: ZipImportJob,
  archivePath: string,
  pictures: PlannedPicture[],
  options: ZipImportOptions,
  limits: AssetZipLimits = ASSET_ZIP_LIMITS
): Promise<void> {
  try {
    const known = options.allowDuplicates ? new Set<string>() : await keysInLibrary(options);
    const total = new UnpackedTotal(limits.maxUnpackedBytes);
    for (const picture of pictures) {
      const key = duplicateKey(picture.name, picture.tags);
      if (known.has(key)) {
        job.duplicateCount += 1;
        if (job.duplicates.length < LISTED) job.duplicates.push(picture.entry.path);
      } else {
        try {
          job.imported.push({ id: await importPicture(archivePath, picture, options, total), name: picture.name });
          if (!options.allowDuplicates) known.add(key);
        } catch (error) {
          if (!(error instanceof PictureSkipped)) throw error;
          skip(job, { file: picture.entry.path, reason: error.message });
        }
      }
      job.processed += 1;
      // Room for other requests between pictures.
      await nextTurn();
    }
    job.status = 'done';
  } catch (error) {
    job.status = 'failed';
    job.message = error instanceof ArchiveLimitError && error.limit === 'total'
      ? `The archive unpacks to more than ${megabytes(limits.maxUnpackedBytes)}, the most an import may. The pictures before that were imported.`
      : 'The import stopped because of an error on the server. The pictures before that were imported.';
    if (!(error instanceof ArchiveLimitError)) logger.error('Asset ZIP import failed', { err: error, jobId: job.id });
  } finally {
    job.finishedAt = Date.now();
  }
}

/**
 * Start importing `pictures` from the archive at `archivePath`, which is
 * removed once the job ends, and return the job at once.
 */
export function startZipImport(
  archivePath: string,
  plan: { pictures: PlannedPicture[]; skipped: SkippedFile[] },
  options: ZipImportOptions
): ZipImportJob {
  forgetOldJobs();
  const job: ZipImportJob = {
    id: randomUUID(),
    userId: options.userId,
    status: 'running',
    total: plan.pictures.length,
    processed: 0,
    imported: [],
    skipped: [],
    skippedCount: 0,
    duplicates: [],
    duplicateCount: 0,
  };
  for (const file of plan.skipped) skip(job, file);
  jobs.set(job.id, job);
  void runZipImport(job, archivePath, plan.pictures, options).finally(() =>
    fs.rm(archivePath, { force: true }).catch(() => undefined)
  );
  return job;
}

/** What a job's owner is told about it. */
export function describeZipImportJob(job: ZipImportJob) {
  const { userId: _userId, finishedAt: _finishedAt, ...shown } = job;
  return shown;
}
