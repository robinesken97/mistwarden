// ============================================
// The banner over a map the GM is preparing
//
// While the GM has a map open to prepare on their own page (CampaignContext's
// viewedMap), this sits over the map and says which map is which: "Preparing
// Crypt. The table is on Village." Back to the table shows the table's map
// again; Bring everyone here moves the table to the map being prepared, as
// the Map Library's Set Active does, asking which tokens go along.
//
// Drawn once, in the page's map part, so both arrangements show it. On the
// compact layout the map's slot gives its buttons a finger's size; upright
// the names and the buttons take two rows, and on a phone on its side one,
// with short labels shown and the full ones as their names. There, too, the
// phone's Back while preparing goes back to the table, asking whatever holds
// the map first.
//
// It also says what it cannot show: which controls still reach the table
// (the campaign's own: the spirit layer, the atmosphere, the vibe and the
// session), and why preparing ended when it ended from elsewhere. A screen
// reader is told when preparing starts and ends, and the keyboard is put on
// the map when the banner it was on goes.
// ============================================

import { useEffect, useRef, useState } from 'react';
import { Eye, Info } from 'lucide-react';
import { useCampaign, TableKeptMovingError, type PreparingEnded } from '@/contexts/CampaignContext';
import { useCompactLayout } from '@/contexts/LayoutContext';
import { useToast } from '@/contexts/ToastContext';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useTableSwitch } from '@/hooks/useTableSwitch';
import { SIDEWAYS_QUERY } from '@/constants/layout';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { dialogOpened, nextOpening } from '@/components/campaign/compact/sheetHistory';
import { apiErrorMessage } from '@/utils/errors';
import TokenTransferConfirmation from './TokenTransferConfirmation';

/** Why preparing ended, as the GM is told. */
export function preparingEndedMessage(ended: PreparingEnded): string {
  return ended.reason === 'deleted'
    ? `${ended.mapName} was deleted, so you are back on the table's map.`
    : "You are no longer the GM, so you are back on the table's map.";
}

/**
 * Whether the banner holds the phone's Back: on the compact layout while a
 * map is being prepared, where Back goes back to the table, asking whatever
 * holds the map first. Elsewhere Paint holds Back itself, while it has paint
 * not saved; each reads this, so Back is never held twice or by no one.
 */
export function preparingHoldsBack(compact: boolean, isPreparing: boolean): boolean {
  return compact && isPreparing;
}

/** Put the keyboard on the map, which takes its keys. */
function focusTheMap() {
  document.querySelector<HTMLElement>('[role="application"][aria-label="Map"]')?.focus({ preventScroll: true });
}

export default function PreparingBanner() {
  const { isPreparing, viewedMap, currentMap, backToTable, preparingEnded, clearPreparingEnded } = useCampaign();
  const compact = useCompactLayout();
  const sideways = useMediaQuery(SIDEWAYS_QUERY);
  const { showToast } = useToast();
  const tableSwitch = useTableSwitch();
  const [leaving, setLeaving] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const goBack = async () => {
    setLeaving(true);
    try {
      await backToTable();
    } catch (err: unknown) {
      showToast(
        err instanceof TableKeptMovingError ? err.message : apiErrorMessage(err) || "Could not load the table's map. Try again.",
        'error',
      );
    } finally {
      setLeaving(false);
    }
  };
  // For the phone's Back, whose entry is held for as long as preparing lasts.
  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;

  useEffect(() => {
    if (!preparingHoldsBack(compact, isPreparing)) return;
    const entry = dialogOpened(() => { void goBackRef.current(); }, nextOpening());
    return () => entry.release();
  }, [compact, isPreparing]);

  // Preparing ended from elsewhere: the map deleted, or the GM seat gone.
  useEffect(() => {
    if (!preparingEnded) return;
    showToast(preparingEndedMessage(preparingEnded), 'info');
    clearPreparingEnded();
  }, [preparingEnded, clearPreparingEnded, showToast]);

  // What a screen reader is told, in a region that stays on the page so the
  // change is read: preparing starting, the table moving meanwhile, and the
  // page going back to the table.
  const viewedName = viewedMap?.name ?? '';
  const tableName = currentMap?.name ?? null;
  const tableWords = tableName ? `The table is on ${tableName}.` : 'The table is on no map.';
  const [announcement, setAnnouncement] = useState('');
  const wasPreparing = useRef(false);
  useEffect(() => {
    if (isPreparing) {
      setAnnouncement(`Preparing ${viewedName}. ${tableWords}`);
    } else if (wasPreparing.current) {
      setAnnouncement(tableName ? `Back on the table's map, ${tableName}.` : "Back on the table's map.");
      // The banner held the keyboard, and has gone: it goes to the map.
      const focused = document.activeElement;
      if (!focused || focused === document.body || !focused.isConnected) focusTheMap();
    }
    wasPreparing.current = isPreparing;
  }, [isPreparing, viewedName, tableName, tableWords]);

  // The banner has no room for a message of its own.
  const { error: switchError, clearError } = tableSwitch;
  useEffect(() => {
    if (!switchError) return;
    showToast(switchError, 'error');
    clearError();
  }, [switchError, clearError, showToast]);

  const live = <p role="status" className="sr-only">{announcement}</p>;
  if (!isPreparing || !viewedMap) return live;
  const short = compact && sideways;

  const help = helpOpen && (
    <p id="preparing-what-reaches-the-table" className="basis-full text-xs">
      Edits to this map reach no player. The campaign's own controls still change every player's screen: the
      Spirit Layer (opening it, its style, who is in the realm), Atmosphere, the vibe and the session controls.
    </p>
  );
  const confirm = (
    <Modal
      open={tableSwitch.pending !== null}
      onClose={tableSwitch.cancel}
      title="Bring everyone here"
      size="sm"
      closeDisabled={tableSwitch.switching}
    >
      {tableSwitch.pending && (
        <TokenTransferConfirmation
          tokens={tableSwitch.tableTokens}
          fromMap={currentMap}
          targetMap={tableSwitch.pending}
          onConfirm={(ids) => { void tableSwitch.confirm(ids); }}
          onCancel={tableSwitch.cancel}
          isSwitching={tableSwitch.switching}
        />
      )}
    </Modal>
  );

  // The wide layout: one strip under the top bar, over the map only: the
  // words, What reaches the table?, then the two ways out.
  if (!compact) {
    const bar = 'min-h-10 pointer-coarse:min-h-11 px-4! py-0! rounded-xl! text-sm';
    return (
      <>
        {live}
        <div
          role="region"
          aria-label="Preparing a map"
          // 60 px tall on touch, 56 with a mouse: 8 + the buttons + 8, its 1 px border inside.
          className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-2 pb-[7px] text-sm text-ink border-b border-[color-mix(in_srgb,var(--color-warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_12%,var(--color-surface))]"
        >
          <p className="min-w-0 flex-1 truncate">
            Preparing <b className="font-semibold text-warning-ink">{viewedMap.name}</b>.{' '}
            {currentMap
              ? <>The table is on <b className="font-semibold text-warning-ink">{currentMap.name}</b>.</>
              : 'The table is on no map.'}
          </p>
          <button
            type="button"
            onClick={() => setHelpOpen((open) => !open)}
            aria-expanded={helpOpen}
            aria-controls={helpOpen ? 'preparing-what-reaches-the-table' : undefined}
            aria-label="What reaches the table?"
            title="What reaches the table?"
            className="-mr-1 inline-flex size-10 pointer-coarse:size-11 shrink-0 items-center justify-center rounded-xl text-ink-muted hover:text-ink hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-brand"
          >
            <Info className="w-5 h-5" aria-hidden="true" />
          </button>
          <Button
            type="button"
            variant="secondary"
            className={bar}
            onClick={() => { void goBack(); }}
            loading={leaving}
            title="Show the table's map again; the map you are preparing stays as you left it"
          >
            Back to the table
          </Button>
          <Button
            type="button"
            className={bar}
            onClick={() => { void tableSwitch.requestSwitch(viewedMap); }}
            loading={tableSwitch.switching && !tableSwitch.pending}
            title="Make this the active map, moving every player onto it"
          >
            Bring everyone here
          </Button>
          {help}
          {confirm}
        </div>
      </>
    );
  }

  return (
    <>
    {live}
    <div
      role="region"
      aria-label="Preparing a map"
      className={`flex items-center gap-x-3 gap-y-1 px-3 py-1.5 bg-info/10 border-b border-info/30 text-info-ink ${short ? '' : 'flex-wrap'}`}
    >
      <p className={`flex items-center gap-1.5 text-xs min-w-0 ${short ? 'flex-1' : 'basis-full sm:basis-auto sm:flex-1'}`}>
        <Eye className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span className="truncate">
          Preparing <strong className="font-semibold">{viewedMap.name}</strong>.{' '}
          {currentMap
            ? <>The table is on <strong className="font-semibold">{currentMap.name}</strong>.</>
            : 'The table is on no map.'}
        </span>
      </p>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => { void goBack(); }}
          loading={leaving}
          aria-label="Back to the table"
          title="Show the table's map again; the map you are preparing stays as you left it"
        >
          {short ? 'Back' : 'Back to the table'}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => { void tableSwitch.requestSwitch(viewedMap); }}
          loading={tableSwitch.switching && !tableSwitch.pending}
          aria-label="Bring everyone here"
          title="Make this the active map, moving every player onto it"
        >
          {short ? 'Bring everyone' : 'Bring everyone here'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconOnly={short}
          icon={Info}
          onClick={() => setHelpOpen((open) => !open)}
          aria-expanded={helpOpen}
          aria-controls={helpOpen ? 'preparing-what-reaches-the-table' : undefined}
          aria-label="What reaches the table?"
        >
          {short ? null : 'What reaches the table?'}
        </Button>
      </div>
      {help}
      {confirm}
    </div>
    </>
  );
}
