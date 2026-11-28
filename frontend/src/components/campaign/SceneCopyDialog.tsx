// ============================================
// SceneCopyDialog: Duplicate scene, Duplicate template and Save as template
//
// A dialog 400 px wide, a sheet of the same rows on a phone: the copy's
// Name, then what comes along as three two-segment choices, Tokens (Leave
// out | Copy), Fog (Reset | Copy) and Drawings (Leave out | Copy), all Copy
// to start with, and a line on what always comes along. It always sends all
// three choices, never leaving one to the server's default.
// ============================================

import { useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';
import FloatingLayer from '@/components/ui/FloatingLayer';
import ChoiceSegments from '@/components/ui/ChoiceSegments';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useTableLayout } from '@/contexts/LayoutContext';
import { MAP_LIMITS } from '@/constants/mapLimits';
import type { DuplicateMapRequest } from '@/types';
import { cn } from '@/utils/cn';

export type SceneCopyKind = 'duplicate' | 'duplicateTemplate' | 'saveAsTemplate';

interface SceneCopyDialogProps {
  kind: SceneCopyKind;
  /** The name of the scene or template copied. */
  sourceName: string;
  /** The scene the table is on, which the help line names. */
  tableName?: string | null;
  /** Makes the copy; resolves once it is made and handled, with null, or with a message to show. */
  onSubmit: (request: Required<Pick<DuplicateMapRequest, 'tokens' | 'fog' | 'drawings'>> & { name: string }) => Promise<string | null>;
  onClose: () => void;
}

const TEXT: Record<SceneCopyKind, { title: string; submit: string }> = {
  duplicate: { title: 'Duplicate scene', submit: 'Duplicate and open to prepare' },
  duplicateTemplate: { title: 'Duplicate template', submit: 'Duplicate' },
  saveAsTemplate: { title: 'Save as template', submit: 'Save as template' },
};

/** The secondary and primary buttons' look: 40 px with a mouse, 44 on a touch screen. */
export const SCENE_BUTTON =
  'inline-flex min-w-0 items-center justify-center gap-2 min-h-10 pointer-coarse:min-h-11 px-4 rounded-xl text-sm whitespace-nowrap transition-colors ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60';
export const SCENE_BUTTON_SECONDARY = `${SCENE_BUTTON} border border-brand font-medium text-brand-ink hover:bg-brand/10`;
export const SCENE_BUTTON_PRIMARY = `${SCENE_BUTTON} bg-brand font-semibold text-brand-text hover:brightness-110`;

type Part = 'leave' | 'copy';

export default function SceneCopyDialog({ kind, sourceName, tableName, onSubmit, onClose }: SceneCopyDialogProps) {
  const phone = useTableLayout() === 'phone';
  const titleId = useId();
  const nameId = useId();
  const helpId = useId();
  const [name, setName] = useState(kind === 'saveAsTemplate' ? sourceName : `${sourceName} (copy)`.slice(0, MAP_LIMITS.maxNameLength));
  const [tokens, setTokens] = useState<Part>('copy');
  const [fog, setFog] = useState<Part>('copy');
  const [drawings, setDrawings] = useState<Part>('copy');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trapRef = useFocusTrap(true, () => { if (!busy) onClose(); });

  useEffect(() => {
    document.getElementById(nameId)?.focus();
  }, [nameId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const refused = await onSubmit({ name: name.trim(), tokens: tokens === 'copy', fog: fog === 'copy', drawings: drawings === 'copy' });
    if (refused) {
      setError(refused);
      setBusy(false);
    }
  };

  const help = kind === 'saveAsTemplate'
    ? 'The picture, grid, walls and lights are always copied. A template is never active and never reaches players.'
    : kind === 'duplicate'
      ? `The picture, grid, walls and lights are always copied.${tableName ? ` The table stays on ${tableName}.` : ''}`
      : 'The picture, grid, walls and lights are always copied. The copy is a template too.';

  return (
    <FloatingLayer>
      <div aria-hidden="true" className="fixed inset-0 z-50 bg-black/50" />
      <div className={cn('fixed inset-0 z-50 flex justify-center', phone ? 'items-end' : 'items-center p-4')}>
        <div
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={cn(
            'flex w-full flex-col gap-2 overflow-y-auto border border-brand/20 bg-surface-light p-4 shadow-2xl',
            phone ? 'max-h-[calc(100dvh-1rem)] rounded-t-2xl pb-[calc(1rem+env(safe-area-inset-bottom))]' : 'max-h-[90dvh] max-w-[25rem] rounded-xl',
          )}
        >
          <form onSubmit={(e) => { void submit(e); }} className="contents">
            <div className="-mt-3 -mr-3 flex items-center gap-2">
              <h2 id={titleId} className="min-w-0 flex-1 font-heading text-lg leading-6 font-bold text-brand-ink">{TEXT[kind].title}</h2>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                aria-label="Close"
                title="Close"
                className="inline-flex size-10 pointer-coarse:size-11 shrink-0 items-center justify-center rounded-xl text-ink-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            <div>
              <label htmlFor={nameId} className="mb-1 block text-xs font-medium text-ink-muted">Name</label>
              <input
                id={nameId}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={MAP_LIMITS.maxNameLength}
                required
                className="h-10 pointer-coarse:h-11 w-full rounded-xl border border-ink/20 bg-paper px-4 text-sm text-ink focus:border-brand focus:outline-hidden focus:ring-2 focus:ring-brand/40"
              />
            </div>
            <ChoiceSegments label="Tokens" value={tokens} onChange={setTokens} options={[['leave', 'Leave out'], ['copy', 'Copy']]} disabled={busy} />
            <ChoiceSegments label="Fog" value={fog} onChange={setFog} options={[['leave', 'Reset'], ['copy', 'Copy']]} disabled={busy} />
            <ChoiceSegments label="Drawings" value={drawings} onChange={setDrawings} options={[['leave', 'Leave out'], ['copy', 'Copy']]} disabled={busy} />
            <p id={helpId} className="text-[0.8125rem] leading-[18px] text-ink-muted">{help}</p>
            {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
            <button type="submit" disabled={busy || !name.trim()} aria-describedby={helpId} className={SCENE_BUTTON_PRIMARY}>
              {TEXT[kind].submit}
            </button>
            <button type="button" onClick={onClose} disabled={busy} className={SCENE_BUTTON_SECONDARY}>Cancel</button>
          </form>
        </div>
      </div>
    </FloatingLayer>
  );
}
