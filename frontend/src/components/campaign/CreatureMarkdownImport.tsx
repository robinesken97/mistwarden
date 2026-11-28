/**
 * Importing 5e-style stat blocks from Markdown files into the instance's
 * Creature Library, under a source tag: a dry run first, its report, then
 * the import. Also deleting a tag's creatures, and giving imported creatures
 * the server's shared token pictures of their names. An administrator's
 * (the server refuses anyone else); every campaign's GM lists the result.
 */

import { useState } from 'react';
import { FileText, Image, Trash2 } from 'lucide-react';
import api from '@/services/api';
import { apiErrorMessage } from '@/utils/errors';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import type { CreatureImportReport } from '@/types';

interface FileReport {
  file: string;
  report?: CreatureImportReport;
  error?: string;
}

const STATUS_LABEL = { imported: 'Imported', updated: 'Updated', skipped: 'Skipped', error: 'Refused' } as const;

/** What a report row says beyond its status: the reason, the errors, the warnings. */
function rowDetails(row: CreatureImportReport['rows'][number]): string {
  if (row.status === 'skipped') return row.reason;
  return [...(row.status === 'error' ? row.errors : []), ...row.warnings].join('; ');
}

export default function CreatureMarkdownImport({ onChanged }: { onChanged: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [tag, setTag] = useState('');
  const [heading, setHeading] = useState('');
  const [busy, setBusy] = useState<'dry' | 'import' | 'delete' | 'match' | null>(null);
  const [reports, setReports] = useState<FileReport[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const sourceTag = tag.trim().toLowerCase();

  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? 'dry' : 'import');
    setError(null);
    setMessage(null);
    const next: FileReport[] = [];
    for (const file of files) {
      try {
        const markdown = await file.text();
        const report = await api.importCreatureMarkdown({ markdown, sourceTag, onlyUnderHeading: heading.trim() || undefined, dryRun });
        next.push({ file: file.name, report });
      } catch (err) {
        next.push({ file: file.name, error: apiErrorMessage(err) || 'The file could not be imported' });
      }
    }
    setReports(next);
    setBusy(null);
    if (!dryRun) onChanged();
  };

  const deleteTag = async () => {
    setBusy('delete');
    setError(null);
    try {
      const { deleted } = await api.deleteImportedCreatures(sourceTag);
      setMessage(`Deleted ${deleted} creature${deleted === 1 ? '' : 's'} imported as "${sourceTag}".`);
      setReports([]);
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err) || 'The creatures could not be deleted');
    } finally {
      setBusy(null);
      setConfirmDelete(false);
    }
  };

  const matchPictures = async () => {
    setBusy('match');
    setError(null);
    try {
      const { matched, withoutPicture } = await api.matchCreatureTokenPictures(sourceTag || undefined);
      setMessage(`Gave ${matched.length} imported creature${matched.length === 1 ? '' : 's'} the token picture of their name`
        + `${matched.length ? `: ${matched.map((m) => m.creature).join(', ')}` : ''}. ${withoutPicture} without one show their type's symbol.`);
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err) || 'The pictures could not be matched');
    } finally {
      setBusy(null);
    }
  };

  return (
    <details className="text-xs border border-moss-green/20 rounded-cozy">
      <summary className="touch-target flex items-center gap-1 px-2 py-1.5 cursor-pointer text-brand-ink font-medium">
        <FileText className="w-3 h-3" /> Import from Markdown
      </summary>
      <div className="px-2 pb-2 space-y-2">
        <p className="text-stone-gray">
          5e-style stat blocks: a <code>###</code> heading per creature with a bold <strong>Armor Class</strong>. Every campaign&apos;s GM sees them, no player does.
        </p>
        <label className="block">
          <span className="block mb-0.5">Markdown files</span>
          <input
            type="file"
            accept=".md,.markdown,text/markdown,text/plain"
            multiple
            onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setReports([]); }}
            className="block w-full min-h-11 text-xs"
          />
        </label>
        <label className="block">
          <span className="block mb-0.5">Source tag</span>
          <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. homebrew" maxLength={32} className="input-cozy w-full min-h-11 text-xs" />
        </label>
        <label className="block">
          <span className="block mb-0.5">Only under heading (optional)</span>
          <input value={heading} onChange={(e) => setHeading(e.target.value)} placeholder="e.g. ## Checked Blocks" maxLength={200} className="input-cozy w-full min-h-11 text-xs" />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" loading={busy === 'dry'} disabled={!files.length || !sourceTag || busy !== null} onClick={() => run(true)}>
            Dry run
          </Button>
          <Button size="sm" loading={busy === 'import'} disabled={!files.length || !sourceTag || busy !== null} onClick={() => run(false)}>
            Import
          </Button>
          <Button size="sm" variant="secondary" icon={Image} loading={busy === 'match'} disabled={busy !== null} onClick={matchPictures}>
            Match token pictures
          </Button>
          <Button size="sm" variant="danger" icon={Trash2} disabled={!sourceTag || busy !== null} onClick={() => setConfirmDelete(true)}>
            Delete tag
          </Button>
        </div>
        {message && <div className="text-success-ink bg-success/10 rounded-sm px-2 py-1">{message}</div>}
        {error && <div className="text-danger-ink bg-danger/10 rounded-sm px-2 py-1">{error}</div>}
        {reports.map(({ file, report, error: fileError }) => (
          <div key={file} className="space-y-1">
            <div className="font-semibold text-ink">{file}</div>
            {fileError && <div className="text-danger-ink">{fileError}</div>}
            {report && (
              <>
                <div className="text-stone-gray">
                  {report.dryRun ? 'Dry run, nothing stored: ' : ''}
                  {report.counts.imported} imported, {report.counts.updated} updated, {report.counts.skipped} skipped, {report.counts.errors} refused
                  {' '}({report.armorClassLines} Armor Class line{report.armorClassLines === 1 ? '' : 's'})
                </div>
                <div className="max-h-64 overflow-auto border border-moss-green/10 rounded-sm">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-stone-gray">
                        <th className="px-1 font-medium">Line</th>
                        <th className="px-1 font-medium">Name</th>
                        <th className="px-1 font-medium">Result</th>
                        <th className="px-1 font-medium">Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((row) => (
                        <tr key={`${row.line}-${row.name}`} className={row.status === 'error' ? 'text-danger-ink' : undefined}>
                          <td className="px-1 align-top">{row.line}</td>
                          <td className="px-1 align-top">{row.name}</td>
                          <td className="px-1 align-top">{STATUS_LABEL[row.status]}</td>
                          <td className="px-1 align-top break-words">{rowDetails(row)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <ConfirmDialog
        isOpen={confirmDelete}
        title="Delete imported creatures"
        message={`Delete every creature imported with the tag "${sourceTag}"? Tokens already placed keep their stat blocks. This cannot be undone.`}
        confirmLabel="Delete"
        isLoading={busy === 'delete'}
        onConfirm={deleteTag}
        onCancel={() => setConfirmDelete(false)}
      />
    </details>
  );
}
