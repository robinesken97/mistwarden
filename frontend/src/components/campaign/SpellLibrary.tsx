/**
 * SpellLibrary
 * Slide-over listing every spell a campaign may use: the SRD 5.1 spells an
 * administrator imported, the server's own and the campaign's own. Every
 * member reads it; the GM adds, changes and deletes the campaign's spells,
 * an administrator the server's and runs the SRD import. Where two share a
 * name both are listed with their source, and the campaign's is the one a
 * sheet's Place area uses (utils/spells.ts resolveSpellByName).
 */

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, ChevronDown, ChevronRight, Loader2, Pencil, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { useCampaign } from '@/contexts/CampaignContext';
import api from '@/services/api';
import { queryKeys, useCampaignSpellsQuery } from '@/hooks/queries';
import { apiErrorMessage } from '@/utils/errors';
import { AREA_ELEMENTS, AREA_LIMITS, AREA_SHAPES, type AreaElement, type AreaShape } from '@/constants/areaLimits';
import { AREA_ELEMENT_STYLES } from './map/layers/drawAreas';
import SlideOver, { SlideOverClose, SlideOverTitle } from '@/components/ui/SlideOver';
import NoticeText from '@/components/common/NoticeText';
import { SRD_ATTRIBUTION, SRD_MODIFIED } from '@/constants/gameContentNotices';
import { SPELL_SCOPE_LABELS, areaInWords, levelInWords, spellScope, type SpellScopeName } from '@/utils/spells';
import type { SpellInput, SpellSummary } from '@/types/spells';
import { cn } from '@/utils/cn';

interface SpellLibraryProps {
  isOpen: boolean;
  onClose: () => void;
}

const LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const SHAPE_LABELS: Record<AreaShape, string> = { sphere: 'Circle', cylinder: 'Cylinder', cone: 'Cone', line: 'Line', cube: 'Cube' };
const ROW = 'touch-target min-h-11 w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-moss-green/5 transition-colors';
const SMALL_ACTION = 'touch-target inline-flex items-center gap-1 text-xs text-brand-ink hover:text-brand-ink/80 transition-colors';

/** The form's state: text fields as typed, numbers as text until saved. */
interface Draft {
  id: string | null;
  scope: 'campaign' | 'instance';
  name: string;
  level: string;
  school: string;
  castingTime: string;
  range: string;
  components: string;
  duration: string;
  concentration: boolean;
  ritual: boolean;
  description: string;
  shape: AreaShape | '';
  sizeFt: string;
  widthFt: string;
  element: AreaElement;
}

const EMPTY_DRAFT: Draft = {
  id: null, scope: 'campaign', name: '', level: '0', school: '', castingTime: '', range: '', components: '', duration: '',
  concentration: false, ritual: false, description: '', shape: '', sizeFt: '20', widthFt: '5', element: 'none',
};

function draftInput(d: Draft): SpellInput {
  const area = d.shape === ''
    ? null
    : { shape: d.shape, sizeFt: parseInt(d.sizeFt, 10) || 0, ...(d.shape === 'line' && { widthFt: parseInt(d.widthFt, 10) || 0 }) };
  return {
    name: d.name, level: parseInt(d.level, 10) || 0, school: d.school, castingTime: d.castingTime, range: d.range,
    components: d.components, duration: d.duration, concentration: d.concentration, ritual: d.ritual,
    description: d.description, area, element: d.element,
  };
}

export default function SpellLibrary({ isOpen, onClose }: SpellLibraryProps) {
  const { campaign, userRole } = useCampaign();
  const campaignId = campaign?.id ?? null;
  const queryClient = useQueryClient();
  const spellsQuery = useCampaignSpellsQuery(isOpen ? campaignId : null);
  const status = useQuery({ queryKey: ['spell-seed-status'], queryFn: () => api.getSpellSeedStatus(), enabled: isOpen });
  const isGM = userRole === 'GM';
  const isAdmin = status.data?.canSeed === true;

  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('');
  const [source, setSource] = useState<SpellScopeName | ''>('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleteArmed, setDeleteArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Read again each time the library opens, so a spell the GM added reaches a player.
  useEffect(() => {
    if (isOpen && campaignId) void queryClient.invalidateQueries({ queryKey: queryKeys.campaignSpells(campaignId) });
  }, [isOpen, campaignId, queryClient]);

  const spells = useMemo(() => spellsQuery.data ?? [], [spellsQuery.data]);
  const shown = useMemo(() => {
    const wanted = search.trim().toLowerCase();
    return spells.filter((s) =>
      (!wanted || s.name.toLowerCase().includes(wanted))
      && (level === '' || s.level === Number(level))
      && (source === '' || spellScope(s) === source));
  }, [spells, search, level, source]);
  const mayListSrd = spells.some((s) => s.source === 'srd') || (status.data?.srdCount ?? 0) > 0;

  const mayEdit = (s: SpellSummary) => (spellScope(s) === 'campaign' ? isGM : spellScope(s) === 'instance' && isAdmin);
  const refresh = () => campaignId && queryClient.invalidateQueries({ queryKey: queryKeys.campaignSpells(campaignId) });

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ ok: true, text: await action() });
      await refresh();
    } catch (err) {
      setMessage({ ok: false, text: apiErrorMessage(err) ?? 'Something went wrong. Try again.' });
    } finally {
      setBusy(false);
    }
  }

  const seed = () => run(async () => {
    const r = await api.seedSrdSpells();
    await queryClient.invalidateQueries({ queryKey: ['spell-seed-status'] });
    return `Imported the SRD spells: ${r.created} new, ${r.updated} brought up to date.`;
  });

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!draft || !campaignId) return;
    const input = draftInput(draft);
    void run(async () => {
      if (draft.scope === 'instance') {
        if (draft.id) await api.updateInstanceSpell(draft.id, input); else await api.createInstanceSpell(input);
      } else if (draft.id) await api.updateCampaignSpell(campaignId, draft.id, input);
      else await api.createCampaignSpell(campaignId, input);
      setDraft(null);
      return `Saved ${input.name}.`;
    });
  };

  const remove = (s: SpellSummary) => {
    if (deleteArmed !== s.id) { setDeleteArmed(s.id); return; }
    setDeleteArmed(null);
    void run(async () => {
      if (spellScope(s) === 'instance') await api.deleteInstanceSpell(s.id); else await api.deleteCampaignSpell(campaignId!, s.id);
      return `Deleted ${s.name}.`;
    });
  };

  async function edit(s: SpellSummary) {
    if (!campaignId) return;
    const full = await api.getCampaignSpell(campaignId, s.id).catch(() => null);
    setDraft({
      id: s.id, scope: spellScope(s) === 'instance' ? 'instance' : 'campaign', name: s.name, level: String(s.level),
      school: s.school ?? '', castingTime: s.castingTime ?? '', range: s.range ?? '', components: s.components ?? '',
      duration: s.duration ?? '', concentration: s.concentration, ritual: s.ritual, description: full?.description ?? '',
      shape: s.area?.shape ?? '', sizeFt: String(s.area?.sizeFt ?? 20), widthFt: String(s.area?.widthFt ?? 5), element: s.element,
    });
  }

  return (
    <SlideOver open={isOpen} onClose={onClose} side="left" backdropClassName="bg-black/40" className="max-w-md bg-paper-white shadow-2xl flex flex-col">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-moss-green/20 bg-parchment/60 sticky top-0 z-10">
        <Sparkles className="w-5 h-5 text-brand-ink shrink-0" aria-hidden="true" />
        <SlideOverTitle className="flex-1 text-base font-bold text-brand-ink">Spell Library</SlideOverTitle>
        <span className="text-xs text-stone-gray/60">{shown.length} spell{shown.length === 1 ? '' : 's'}</span>
        <SlideOverClose className="btn-secondary p-1.5 shrink-0" iconClassName="w-4 h-4" title="Close" />
      </div>

      {message && (
        <p role="status" className={cn('mx-4 mt-2 text-xs rounded-sm px-2 py-1', message.ok ? 'text-success-ink bg-success/10' : 'text-danger-ink bg-danger/10')}>{message.text}</p>
      )}
      {draft ? (
        <SpellForm draft={draft} setDraft={setDraft} onSubmit={save} busy={busy} isAdmin={isAdmin} isGM={isGM} />
      ) : (
        <>
          <div className="px-4 py-3 border-b border-moss-green/10 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-gray/50" aria-hidden="true" />
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search spells..." aria-label="Search spells" className="input-cozy w-full pl-8 text-sm" />
            </div>
            <div className="flex gap-2">
              <select aria-label="Level" value={level} onChange={(e) => setLevel(e.target.value)} className="input-cozy text-sm flex-1">
                <option value="">All levels</option>
                {LEVELS.map((l) => <option key={l} value={l}>{levelInWords(l)}</option>)}
              </select>
              <select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value as SpellScopeName | '')} className="input-cozy text-sm flex-1">
                <option value="">All sources</option>
                {(Object.keys(SPELL_SCOPE_LABELS) as SpellScopeName[]).map((k) => <option key={k} value={k}>{SPELL_SCOPE_LABELS[k]}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap gap-x-4">
              {(isGM || isAdmin) && (
                <button type="button" className={SMALL_ACTION} onClick={() => setDraft({ ...EMPTY_DRAFT, scope: isGM ? 'campaign' : 'instance' })}>
                  <Plus className="w-3 h-3" aria-hidden="true" /> New spell
                </button>
              )}
              {isAdmin && (
                <button type="button" className={SMALL_ACTION} onClick={seed} disabled={busy}>
                  {busy ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : <BookOpen className="w-3 h-3" aria-hidden="true" />}
                  {(status.data?.srdCount ?? 0) > 0 ? 'Update SRD spells' : 'Import SRD spells'}
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {spellsQuery.isLoading && <p className="px-4 py-6 text-sm text-stone-gray">Loading spells...</p>}
            {spellsQuery.isError && <p className="px-4 py-6 text-sm text-danger-ink">{apiErrorMessage(spellsQuery.error) ?? 'Could not load the spells.'}</p>}
            {spellsQuery.isSuccess && spells.length === 0 && (
              <p className="px-4 py-6 text-sm text-stone-gray">
                {isAdmin ? 'No spells yet. Import the SRD spells or add one of your own.' : 'No spells yet. An administrator can import the SRD spells.'}
              </p>
            )}
            <ul className="divide-y divide-moss-green/10">
              {shown.map((s) => (
                <li key={s.id}>
                  <button type="button" className={ROW} aria-expanded={openId === s.id} onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                    {openId === s.id ? <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="w-4 h-4 shrink-0" aria-hidden="true" />}
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-ink truncate">{s.name}</span>
                      <span className="block text-xs text-ink-muted">
                        {levelInWords(s.level)}{s.school ? ` · ${s.school}` : ''}{s.area ? ` · ${areaInWords(s.area)}` : ''}
                      </span>
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full border border-moss-green/30 text-stone-gray shrink-0">{SPELL_SCOPE_LABELS[spellScope(s)]}</span>
                  </button>
                  {openId === s.id && campaignId && (
                    <SpellDetails campaignId={campaignId} spell={s}>
                      {mayEdit(s) && (
                        <div className="flex gap-4">
                          <button type="button" className={SMALL_ACTION} onClick={() => void edit(s)}><Pencil className="w-3 h-3" aria-hidden="true" /> Edit</button>
                          <button type="button" className={cn(SMALL_ACTION, 'text-danger-ink hover:text-danger-ink')} onClick={() => remove(s)} onBlur={() => setDeleteArmed(null)} disabled={busy}>
                            <Trash2 className="w-3 h-3" aria-hidden="true" /> {deleteArmed === s.id ? 'Tap again to delete' : 'Delete'}
                          </button>
                        </div>
                      )}
                    </SpellDetails>
                  )}
                </li>
              ))}
            </ul>
          </div>
          {mayListSrd && (
            // The credit the SRD's CC BY 4.0 licence asks for wherever its material is shown.
            <div className="space-y-1 px-4 py-2 border-t border-moss-green/10">
              <NoticeText text={SRD_ATTRIBUTION} className="text-xs text-ink-muted" />
              <NoticeText text={SRD_MODIFIED} className="text-xs text-ink-muted" />
            </div>
          )}
        </>
      )}
    </SlideOver>
  );
}

/** A listed spell opened: its particulars, and its description read from the server. */
function SpellDetails({ campaignId, spell, children }: { campaignId: string; spell: SpellSummary; children: ReactNode }) {
  const full = useQuery({ queryKey: ['campaign-spell', campaignId, spell.id], queryFn: () => api.getCampaignSpell(campaignId, spell.id) });
  const facts: Array<[string, string | null]> = [
    ['Casting time', spell.castingTime], ['Range', spell.range], ['Components', spell.components], ['Duration', spell.duration],
    ['Area', spell.area ? `${areaInWords(spell.area)}, ${AREA_ELEMENT_STYLES[spell.element].name}` : 'No area'],
  ];
  return (
    <div className="px-4 pb-3 space-y-2 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        {facts.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="contents"><dt className="text-ink-muted">{k}</dt><dd className="text-ink">{v}</dd></div>
        ))}
        {(spell.concentration || spell.ritual) && (
          <div className="contents"><dt className="text-ink-muted">Also</dt><dd className="text-ink">{[spell.concentration && 'Concentration', spell.ritual && 'Ritual'].filter(Boolean).join(', ')}</dd></div>
        )}
      </dl>
      {full.isLoading && <p className="text-xs text-stone-gray">Loading description...</p>}
      {full.data?.description && <p className="text-xs text-ink whitespace-pre-line">{full.data.description}</p>}
      {children}
    </div>
  );
}

interface SpellFormProps {
  draft: Draft;
  setDraft: (d: Draft | null) => void;
  onSubmit: (e: FormEvent) => void;
  busy: boolean;
  isAdmin: boolean;
  isGM: boolean;
}

function SpellForm({ draft, setDraft, onSubmit, busy, isAdmin, isGM }: SpellFormProps) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value });
  const text = (key: 'school' | 'castingTime' | 'range' | 'components' | 'duration', label: string) => (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-stone-gray">{label}</span>
      <input type="text" value={draft[key]} onChange={(e) => set(key, e.target.value)} className="input-cozy w-full text-sm" />
    </label>
  );
  return (
    <form onSubmit={onSubmit} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
      <label className="block space-y-1">
        <span className="text-xs font-medium text-stone-gray">Name</span>
        <input type="text" required value={draft.name} onChange={(e) => set('name', e.target.value)} className="input-cozy w-full text-sm" />
      </label>
      {/* Only a new spell may choose: an existing one stays where it is. */}
      {draft.id === null && isAdmin && isGM && (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-stone-gray">For</span>
          <select value={draft.scope} onChange={(e) => set('scope', e.target.value as Draft['scope'])} className="input-cozy w-full text-sm">
            <option value="campaign">This campaign</option>
            <option value="instance">Every campaign on this server</option>
          </select>
        </label>
      )}
      <label className="block space-y-1">
        <span className="text-xs font-medium text-stone-gray">Level</span>
        <select value={draft.level} onChange={(e) => set('level', e.target.value)} className="input-cozy w-full text-sm">
          {LEVELS.map((l) => <option key={l} value={l}>{levelInWords(l)}</option>)}
        </select>
      </label>
      {text('school', 'School')}
      {text('castingTime', 'Casting time')}
      {text('range', 'Range')}
      {text('components', 'Components')}
      {text('duration', 'Duration')}
      <div className="flex gap-4">
        <label className="touch-target flex items-center gap-2 text-xs text-stone-gray"><input type="checkbox" checked={draft.concentration} onChange={(e) => set('concentration', e.target.checked)} className="accent-moss-green" /> Concentration</label>
        <label className="touch-target flex items-center gap-2 text-xs text-stone-gray"><input type="checkbox" checked={draft.ritual} onChange={(e) => set('ritual', e.target.checked)} className="accent-moss-green" /> Ritual</label>
      </div>
      <fieldset className="space-y-2 border-t border-moss-green/20 pt-2">
        <legend className="text-xs font-semibold text-brand-ink">Area</legend>
        <select aria-label="Area shape" value={draft.shape} onChange={(e) => set('shape', e.target.value as AreaShape | '')} className="input-cozy w-full text-sm">
          <option value="">No area</option>
          {AREA_SHAPES.map((shape) => <option key={shape} value={shape}>{SHAPE_LABELS[shape]}</option>)}
        </select>
        {draft.shape !== '' && (
          <div className="flex gap-2">
            <label className="flex-1 space-y-1">
              <span className="text-xs font-medium text-stone-gray">{draft.shape === 'sphere' || draft.shape === 'cylinder' ? 'Radius' : draft.shape === 'cube' ? 'Side' : 'Length'} (ft)</span>
              <input type="number" min={AREA_LIMITS.minSizeFt} max={AREA_LIMITS.maxSizeFt} step={5} value={draft.sizeFt} onChange={(e) => set('sizeFt', e.target.value)} className="input-cozy w-full text-sm" />
            </label>
            {draft.shape === 'line' && (
              <label className="flex-1 space-y-1">
                <span className="text-xs font-medium text-stone-gray">Width (ft)</span>
                <input type="number" min={AREA_LIMITS.minWidthFt} max={AREA_LIMITS.maxWidthFt} step={5} value={draft.widthFt} onChange={(e) => set('widthFt', e.target.value)} className="input-cozy w-full text-sm" />
              </label>
            )}
          </div>
        )}
        <label className="block space-y-1">
          <span className="text-xs font-medium text-stone-gray">Look</span>
          <select value={draft.element} onChange={(e) => set('element', e.target.value as AreaElement)} className="input-cozy w-full text-sm">
            {AREA_ELEMENTS.map((el) => <option key={el} value={el}>{AREA_ELEMENT_STYLES[el].name}</option>)}
          </select>
        </label>
      </fieldset>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-stone-gray">Description</span>
        <textarea value={draft.description} onChange={(e) => set('description', e.target.value)} rows={6} className="input-cozy w-full text-sm" />
      </label>
      <div className="flex gap-2 justify-end">
        <button type="button" className="btn-secondary touch-target px-3 py-1.5 text-sm" onClick={() => setDraft(null)}>Cancel</button>
        <button type="submit" className="btn-primary touch-target px-3 py-1.5 text-sm" disabled={busy || draft.name.trim() === ''}>Save</button>
      </div>
    </form>
  );
}
