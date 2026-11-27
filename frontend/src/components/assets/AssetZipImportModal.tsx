// Added for Mistwarden on 2026-11-27.
// ============================================
// AssetZipImportModal
// Imports a ZIP of pictures into the asset library, one asset each, named
// after the file and tagged with its folders (POST /api/assets/import-zip).
// Shows the upload's progress, then the import's, then what was imported,
// skipped and left out as already there.
// ============================================

import { useEffect, useRef, useState } from 'react';
import { FileArchive } from 'lucide-react';
import { api } from '@/services/api';
import campaignService from '@/services/campaign.service';
import { useAuth } from '@/contexts/AuthContext';
import { Button, Modal } from '@/components/ui';
import { apiErrorMessage } from '@/utils/errors';
import { campaignsToPlaceAssetIn } from '@/utils/campaignRoles';
import { AssetScope, AssetType, PlatformRole, type AssetZipImportJob, type Campaign } from '@/types';

interface AssetZipImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Told each time the import has stored pictures, so the library can be fetched again. */
  onImported: () => void;
}

/** A choice in a row of equal pills: on is the accent frame and tint, off a grey frame. */
const pill = (on: boolean) =>
  `min-h-11 px-3 rounded-full border text-sm font-medium transition-colors disabled:opacity-50 ${
    on ? 'bg-warm-amber/25 border-warm-amber text-accent-ink' : 'border-ink-muted/30 text-stone-gray hover:bg-warm-amber/10'
  }`;

/** How often the import's progress is asked for. */
const POLL_MS = 1000;

export default function AssetZipImportModal({ isOpen, onClose, onImported }: AssetZipImportModalProps) {
  const { user } = useAuth();
  const canImportGlobal = user?.platformRole === PlatformRole.ADMIN || user?.globalAssetManager === true;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState<AssetType.TOKEN | AssetType.MAP>(AssetType.TOKEN);
  const [scope, setScope] = useState<AssetScope>(AssetScope.USER);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [tags, setTags] = useState('');
  const [dropTopFolder, setDropTopFolder] = useState(true);
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [job, setJob] = useState<AssetZipImportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Stops the progress requests once the dialog is closed.
  const polling = useRef(0);

  // The campaigns whose library a ZIP may fill: those the user runs.
  useEffect(() => {
    if (!isOpen) return;
    campaignService.getCampaigns().then((all) => {
      const run = campaignsToPlaceAssetIn(all, false, user?.id);
      setCampaigns(run);
      if (run.length === 1) setCampaignId(run[0].id);
    }).catch(() => setCampaigns([]));
  }, [isOpen, user?.id]);

  useEffect(() => () => { polling.current += 1; }, []);

  const uploading = uploadPercent !== null && job === null;
  const running = uploading || job?.status === 'running';

  const reset = () => {
    polling.current += 1;
    setFile(null);
    setUploadPercent(null);
    setJob(null);
    setError(null);
  };

  const handleClose = () => {
    if (uploading) return;
    reset();
    onClose();
  };

  const follow = async (jobId: string, turn: number) => {
    let stored = 0;
    while (polling.current === turn) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      if (polling.current !== turn) return;
      try {
        const { job: now } = await api.getAssetZipImport(jobId);
        if (polling.current !== turn) return;
        setJob(now);
        if (now.imported.length > stored) {
          stored = now.imported.length;
          onImported();
        }
        if (now.status !== 'running') return;
      } catch (err: unknown) {
        setError(apiErrorMessage(err) ?? 'Lost track of the import. The pictures imported so far are in the library.');
        return;
      }
    }
  };

  const start = async () => {
    if (!file) return;
    if (scope === AssetScope.CAMPAIGN && !campaignId) {
      setError('Choose the campaign to import into.');
      return;
    }
    setError(null);
    setUploadPercent(0);
    // The fields before the file, as the server reads them.
    const form = new FormData();
    form.append('type', type);
    form.append('scope', scope);
    if (scope === AssetScope.CAMPAIGN) form.append('campaignId', campaignId);
    if (tags.trim()) form.append('tags', tags);
    form.append('dropTopFolder', String(dropTopFolder));
    form.append('allowDuplicates', String(allowDuplicates));
    form.append('file', file);
    try {
      const { job: started } = await api.importAssetZip(form, setUploadPercent);
      setJob(started);
      polling.current += 1;
      void follow(started.id, polling.current);
    } catch (err: unknown) {
      setUploadPercent(null);
      setError(apiErrorMessage(err) ?? 'The archive could not be imported.');
    }
  };

  const scopes = [
    { scope: AssetScope.USER, label: 'Personal' },
    ...(campaigns.length > 0 ? [{ scope: AssetScope.CAMPAIGN, label: 'Campaign' }] : []),
    ...(canImportGlobal ? [{ scope: AssetScope.GLOBAL, label: 'Global' }] : []),
  ];
  const gridCols = ['grid-cols-1', 'grid-cols-2', 'grid-cols-3'][scopes.length - 1];

  const percent = job
    ? (job.total === 0 ? 100 : Math.round((job.processed / job.total) * 100))
    : uploadPercent ?? 0;
  const progressLabel = job
    ? `Importing ${job.processed.toLocaleString()} of ${job.total.toLocaleString()} pictures`
    : `Uploading the archive, ${percent}%`;
  const finished = job && job.status !== 'running';

  return (
    <Modal
      open={isOpen}
      onClose={handleClose}
      title="Import ZIP"
      icon={FileArchive}
      size="lg"
      closeDisabled={uploading}
      footer={
        <div className="flex justify-end gap-3">
          {finished ? (
            <>
              <Button variant="secondary" onClick={reset} className="min-h-11">Import another</Button>
              <Button onClick={handleClose} className="min-h-11">Done</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={handleClose} disabled={uploading} className="min-h-11">Cancel</Button>
              <Button onClick={start} disabled={!file || running} className="min-h-11">Import</Button>
            </>
          )}
        </div>
      }
    >
      <div className="space-y-5">
        {!job && (
          <>
            <p className="text-sm text-stone-gray">
              Every picture becomes an asset, named after its file and tagged with the folders it is in:
              <span className="text-brand-ink"> Beasts/Horses/brown_horse.png</span> becomes “brown horse”, tagged Beasts and Horses.
            </p>

            <fieldset disabled={running}>
              <legend className="block text-sm font-medium text-brand-ink mb-2">Import as</legend>
              <div className="grid grid-cols-2 gap-2">
                {[{ value: AssetType.TOKEN, label: 'Tokens' }, { value: AssetType.MAP, label: 'Maps' }].map((o) => (
                  <button key={o.value} type="button" aria-pressed={type === o.value} onClick={() => setType(o.value as AssetType.TOKEN | AssetType.MAP)} className={pill(type === o.value)}>
                    {o.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset disabled={running}>
              <legend className="block text-sm font-medium text-brand-ink mb-2">Save to</legend>
              <div className={`grid ${gridCols} gap-2`}>
                {scopes.map((o) => (
                  <button key={o.scope} type="button" aria-pressed={scope === o.scope} onClick={() => setScope(o.scope)} className={pill(scope === o.scope)}>
                    {o.label}
                  </button>
                ))}
              </div>
              {scope === AssetScope.CAMPAIGN && (
                <select
                  aria-label="Campaign"
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                  className="input-cozy mt-2"
                >
                  <option value="">Choose a campaign</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
            </fieldset>

            <div>
              <label htmlFor="zip-import-tags" className="block text-sm font-medium text-brand-ink mb-2">
                Extra tags <span className="font-normal text-xs text-stone-gray/70">for every picture, comma-separated</span>
              </label>
              <input
                id="zip-import-tags"
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                disabled={running}
                placeholder="e.g. Token pack"
                className="input-cozy min-h-11"
              />
            </div>

            <fieldset disabled={running}>
              <legend className="sr-only">Options</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button type="button" aria-pressed={dropTopFolder} onClick={() => setDropTopFolder((v) => !v)} className={pill(dropTopFolder)}>
                  Leave out the shared top folder
                </button>
                <button type="button" aria-pressed={allowDuplicates} onClick={() => setAllowDuplicates((v) => !v)} className={pill(allowDuplicates)}>
                  Import duplicates too
                </button>
              </div>
            </fieldset>

            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                disabled={running}
                onClick={() => fileInputRef.current?.click()}
                className="w-full min-h-11 border-2 border-dashed border-moss-green/30 hover:border-moss-green/50 rounded-lg p-6 text-center disabled:opacity-50"
              >
                <FileArchive className="w-10 h-10 mx-auto mb-2 text-stone-gray/50" aria-hidden="true" />
                {file ? (
                  <span className="block">
                    <span className="block text-brand-ink font-medium">{file.name}</span>
                    <span className="block text-sm text-stone-gray">{(file.size / (1024 * 1024)).toFixed(1)} MB</span>
                  </span>
                ) : (
                  <span className="block text-stone-gray font-medium">Choose a ZIP file</span>
                )}
              </button>
            </div>
          </>
        )}

        {(uploadPercent !== null || job) && (
          <div>
            <div className="flex justify-between text-sm text-stone-gray mb-1">
              <span>{finished ? 'Finished' : progressLabel}</span>
              <span>{percent}%</span>
            </div>
            <div
              className="h-2 rounded-full bg-ink-muted/20 overflow-hidden"
              role="progressbar"
              aria-label={finished ? 'Finished' : progressLabel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div className="h-full bg-warm-amber transition-[width] duration-300" style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}

        {job && (
          <div className="space-y-2 text-sm" aria-live="polite">
            <p className="text-brand-ink font-medium">
              {job.imported.length.toLocaleString()} imported
              {job.duplicateCount > 0 && `, ${job.duplicateCount.toLocaleString()} already in the library`}
              {job.skippedCount > 0 && `, ${job.skippedCount.toLocaleString()} skipped`}
            </p>
            {job.message && <p className="alert-danger">{job.message}</p>}
            {job.duplicates.length > 0 && (
              <details>
                <summary className="min-h-11 flex items-center cursor-pointer text-stone-gray">Already in the library (same name and tags)</summary>
                <ul className="max-h-40 overflow-y-auto pl-4 list-disc text-stone-gray">
                  {job.duplicates.map((d) => <li key={d} className="break-all">{d}</li>)}
                </ul>
              </details>
            )}
            {job.skipped.length > 0 && (
              <details>
                <summary className="min-h-11 flex items-center cursor-pointer text-stone-gray">Skipped files</summary>
                <ul className="max-h-48 overflow-y-auto pl-4 list-disc text-stone-gray space-y-1">
                  {job.skipped.map((s) => (
                    <li key={s.file} className="break-all"><span className="text-brand-ink">{s.file}</span>: {s.reason}</li>
                  ))}
                </ul>
                {job.skippedCount > job.skipped.length && (
                  <p className="text-xs text-stone-gray/70 mt-1">and {(job.skippedCount - job.skipped.length).toLocaleString()} more</p>
                )}
              </details>
            )}
          </div>
        )}

        {error && <p className="alert-danger" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
